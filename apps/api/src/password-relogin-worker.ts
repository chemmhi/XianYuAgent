import type { Store } from './domain.js';
import type { AuthService } from './services.js';
import type { PasswordLoginService } from './password-login.js';

export class PasswordReloginWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopped = true;
  constructor(private readonly store: Store, private readonly auth: AuthService, private readonly login: PasswordLoginService,
    private readonly checkCookie: (adminId: string, accountId: string) => Promise<{ success: boolean; accountInvalid?: boolean; errorCode?: string }>,
    private readonly reconnect: (adminId: string, accountId: string) => Promise<void>, private readonly pollMs = 15_000) {}
  start() { if (!this.stopped) return; this.stopped = false; this.timer = setInterval(() => void this.tick().catch(() => undefined), this.pollMs); this.timer.unref(); void this.tick().catch(() => undefined); }
  tick() {
    if (this.running) return this.running;
    this.running = this.scan().finally(() => { this.running = undefined; }); return this.running;
  }
  private async scan() {
    const repo = this.login.vault.repository;
    for (const row of await repo.due(Date.now(), 20)) {
      if (this.stopped) return;
      try {
        await this.auth.assertActorAccess(row.adminId);
        const account = await this.store.getAccount(row.adminId, row.accountId);
        const scope = (await this.store.listScopes(row.adminId)).some(s => s.accountId === row.accountId && s.scope === 'manage');
        const credential = await this.store.getCredential(row.adminId, row.accountId);
        if (!account || !scope || account.status === 'disabled' || !credential || credential.status === 'revoked') {
          await repo.settle(row, Date.now(), 'PASSWORD_RECOVERY_ACCESS_DISABLED', true); continue;
        }
        const expired = credential.status === 'expired' || account.status === 'expired';
        const offline = ['disconnected', 'failed'].includes(account.transportStatus ?? '')
          && Date.parse(account.transportSeenAt ?? account.updatedAt) < Date.now() - 90_000;
        if (!expired && !offline) { await repo.settle(row, Date.now() + 30_000); continue; }
        if (!expired) {
          const checked = await this.checkCookie(row.adminId, row.accountId);
          if (checked.success) {
            await this.reconnect(row.adminId, row.accountId); await repo.settle(row, Date.now() + 90_000); continue;
          }
          if (!checked.accountInvalid && !/SESSION_EXPIRED|CREDENTIAL_MISSING|LOGIN.*INVALID/.test(checked.errorCode ?? '')) {
            await repo.settle(row, Date.now() + 300_000, 'PASSWORD_RECOVERY_COOKIE_CHECK_PENDING'); continue;
          }
        }
        await this.login.recover(row);
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : error instanceof Error ? error.message : '';
        if (/BUSY/.test(code)) continue;
        await repo.settle(row, Date.now() + 300_000, 'PASSWORD_RECOVERY_FAILED', /FORBIDDEN|UNAUTHENTICATED|INVITE_ACCESS|SECRET_INVALID/.test(code)).catch(() => undefined);
      }
    }
  }
  async stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); await this.running; }
}
