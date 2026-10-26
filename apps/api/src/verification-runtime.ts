import type { Store } from './domain.js';
import type { AppConfig } from './config.js';
import { AuthService } from './services.js';
import { PostgresStore } from './store-postgres.js';
import { MemoryVerificationRepository, PostgresVerificationRepository, type VerificationRepository } from './verification-repository.js';
import { VerificationCoordinator } from './verification-coordinator.js';
import { VerificationRemoteBrowser } from './verification-remote-browser.js';
import { verificationDto } from './verification-dto.js';
import { VerificationError, type VerificationChallenge, type VerificationSubject, type VerificationSession } from './verification-domain.js';
import { isImVerificationSource } from './xianyu-verification-request.js';
import type { XianyuVerificationPage } from './xianyu-browser-port.js';

export interface VerificationRuntimeOptions {
  repository?: VerificationRepository;
  /** Dependency injection for controlled local Chrome fixtures; never client input. */
  allowedOrigins?: readonly string[];
}
export class VerificationRuntime {
  readonly coordinator: VerificationCoordinator;
  constructor(readonly store: Store, readonly auth: AuthService, readonly config: AppConfig,
    readonly options: VerificationRuntimeOptions = {}, private readonly recover?: (subject: VerificationSubject) => void) {
    const repository = options.repository ?? (store instanceof PostgresStore ? new PostgresVerificationRepository(store.pool) : new MemoryVerificationRepository());
    this.coordinator = new VerificationCoordinator(repository, { authorize: (subject, adminId) => this.authorize(subject, adminId), health: (subject, session) => this.health(subject, session) });
  }
  eligible(subject: VerificationSubject) {
    return this.config.xianyuVerificationRemoteEnabled === true
      && (!this.config.xianyuVerificationRemoteAdmins?.length || this.config.xianyuVerificationRemoteAdmins.includes(subject.adminId))
      && (!subject.accountId || !this.config.xianyuVerificationRemoteAccounts?.length || this.config.xianyuVerificationRemoteAccounts.includes(subject.accountId));
  }
  async authorize(subject: VerificationSubject, adminId: string) {
    if (!this.eligible(subject)) return false;
    try { await this.auth.assertActorAccess(adminId); } catch { return false; }
    let accountId = subject.accountId;
    if (subject.loginSessionId) {
      const login = await this.store.getLoginSessionById(adminId, subject.loginSessionId);
      if (!login || login.adminId !== adminId || login.adminId !== subject.adminId || Date.parse(login.expiresAt) <= Date.now()
        || ['cancelled', 'expired', 'failed'].includes(login.status)) return false;
      accountId = login.accountId;
    }
    if (!accountId) return true;
    if (this.config.xianyuVerificationRemoteAccounts?.length && !this.config.xianyuVerificationRemoteAccounts.includes(accountId)) return false;
    const account = await this.store.getAccount(adminId, accountId);
    const scopes = await this.store.listScopes(adminId);
    return !!account && account.status !== 'disabled'
      && (subject.credentialGeneration === undefined || account.credentialGeneration === subject.credentialGeneration)
      && scopes.some(scope => scope.accountId === accountId && scope.scope === 'manage' && scope.status === 'active'
        && (!scope.expiresAt || Date.parse(scope.expiresAt) > Date.now()));
  }
  private async health(subject: VerificationSubject, session?: VerificationSession): Promise<'ready' | 'partial' | 'pending' | 'cancelled'> {
    if (!await this.authorize(subject, subject.adminId)) return 'cancelled';
    if (subject.loginSessionId) {
      const login = await this.store.getLoginSessionById(subject.adminId, subject.loginSessionId);
      return login?.status === 'succeeded' ? 'ready' : 'pending';
    }
    const account = await this.store.getAccount(subject.adminId, subject.accountId!);
    const credential = await this.store.getCredential(subject.adminId, subject.accountId!);
    if (credential?.status !== 'active') return 'cancelled';
    const risks = await this.store.listAccountVerificationRisks(subject.adminId, subject.accountId!);
    const fresh = account?.transportStatus === 'connected' && !!account.transportSeenAt
      && Date.parse(account.transportSeenAt) > Math.max(Date.now() - 15_000, session?.createdAt ?? 0);
    if (subject.source && !isImVerificationSource(subject.source)) {
      if (risks.some(risk => risk.source === subject.source)) return 'pending';
      return risks.length || !fresh ? 'partial' : 'ready';
    }
    if (!fresh || risks.some(risk => isImVerificationSource(risk.source))) return 'pending';
    return risks.length ? 'partial' : 'ready';
  }
  async dto(row: VerificationSession) {
    const account = row.subject.accountId ? await this.store.getAccount(row.subject.adminId, row.subject.accountId) : undefined;
    return verificationDto(row, account ? { status: account.status, transportStatus: account.transportStatus, transportSeenAt: account.transportSeenAt,
      riskSources: (await this.store.listAccountVerificationRisks(row.subject.adminId, account.id)).map(risk => risk.source) } : undefined);
  }
  async list(adminId: string, active = false) {
    const rows = await this.coordinator.list(adminId);
    return { sessions: await Promise.all(rows.filter(row => !active || !['succeeded', 'completed_partial', 'failed', 'expired', 'cancelled'].includes(row.state)).map(row => this.dto(row))), serverTime: Date.now() };
  }
  async runChallenge(input: Omit<VerificationChallenge, 'browser'> & { page: XianyuVerificationPage; previousId?: string; onCreated?: (id: string) => void }) {
    let sessionId = input.previousId;
    const browser = new VerificationRemoteBrowser(input.page, { allowedOrigins: this.options.allowedOrigins, onInvalidate: streamEpoch => {
      if (sessionId) this.coordinator.events.emit('stream-invalidated', { sessionId, streamEpoch });
    } });
    const challenge = { ...input, browser, autoAllowed: this.config.xianyuVerificationSliderMode === 'auto' && input.autoAllowed !== false, autoAttempt: async (...args: Parameters<typeof input.autoAttempt>) => {
      if (this.config.xianyuVerificationSliderMode !== 'auto' || input.autoAllowed === false) throw new VerificationError('VERIFICATION_AUTO_DISABLED', 503);
      return input.autoAttempt(...args);
    } };
    return input.previousId ? this.coordinator.continueChallenge(input.previousId, challenge)
      : this.coordinator.solve(challenge, id => { sessionId = id; input.onCreated?.(id); });
  }
  async retry(subject: VerificationSubject, mode: 'manual_only' | 'manual_then_auto') {
    if (this.config.xianyuVerificationBrowserMode === 'disabled') throw new VerificationError('VERIFICATION_BROWSER_DISABLED', 503);
    if (mode === 'manual_then_auto' && this.config.xianyuVerificationSliderMode !== 'auto') throw new VerificationError('VERIFICATION_AUTO_DISABLED', 503);
    if (subject.loginSessionId) {
      const login = await this.store.getLoginSessionById(subject.adminId, subject.loginSessionId);
      if (login?.status === 'succeeded') throw new VerificationError('VERIFICATION_QR_FINISHED', 410);
    }
    const row = await this.coordinator.retry(subject, mode);
    if (!row) this.recover?.(subject);
    return row ? { session: await this.dto(row) } : { session: undefined, pending: true };
  }
  async cancel(subjectId: string) { await this.coordinator.cancelSubject(subjectId); }
  async close() { await this.coordinator.close(); }
}
