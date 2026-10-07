import type { CredentialRefRecord, CredentialRefStatus, Store } from './domain.js';
import { credentialFingerprint, decryptCredentialValue, encryptCredentialValue } from './credential-crypto.js';
import { ServiceError } from './services.js';

type Audit = (input: { actorId: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string }) => Promise<string>;

export interface CredentialRefView extends CredentialRefRecord {}

export class ApiKeyCredentialService {
  constructor(private readonly store: Store, private readonly encryptionKey: string, private readonly audit: Audit) {}

  async list(input: { adminId: string; accountId: string }): Promise<CredentialRefView[]> {
    this.requireAccountId(input.accountId);
    try {
      return await this.store.listCredentialRefs(input.adminId, input.accountId);
    } catch (error) {
      if (error instanceof Error && error.message === 'ACCOUNT_SCOPE_FORBIDDEN') throw new ServiceError(403, 'FORBIDDEN', '当前管理员没有该账号的凭证权限');
      throw error;
    }
  }

  async getSecret(input: { adminId: string; accountId: string; credentialId: string }): Promise<{ ref: CredentialRefView; apiKey: string }> {
    this.requireAccountId(input.accountId);
    const stored = await this.store.getCredentialRefSecret(input.adminId, input.credentialId);
    if (!stored || stored.ref.accountId !== input.accountId) throw new ServiceError(404, 'NOT_FOUND', 'credential not found');
    if (stored.ref.status !== 'active') throw new ServiceError(409, 'CREDENTIAL_NOT_ACTIVE', '该凭证未启用，无法读取模型列表');
    try {
      return { ref: stored.ref, apiKey: decryptCredentialValue(stored.secretCiphertext, this.encryptionKey) };
    } catch {
      throw new ServiceError(500, 'CREDENTIAL_SECRET_INVALID', '凭证密文无法解密');
    }
  }

  async create(input: { adminId: string; accountId: string; provider: string; alias: string; label?: string; apiKey: string; metadata?: Record<string, string>; requestId: string; traceId: string }): Promise<CredentialRefView> {
    this.validateKeyInput(input);
    const fingerprint = credentialFingerprint(input.apiKey);
    try {
      const ref = await this.store.createCredentialRef({ ...input, secretCiphertext: encryptCredentialValue(input.apiKey, this.encryptionKey), fingerprint });
      if (ref.purpose === 'model_client') await this.store.bumpModelProviderConfigGeneration({ adminId: input.adminId, accountId: ref.accountId });
      await this.audit({ actorId: input.adminId, action: 'credential_ref.created', targetRef: ref.id, requestId: input.requestId, traceId: input.traceId, payload: { provider: ref.provider, alias: ref.alias, kind: ref.kind, purpose: ref.purpose, fingerprint: ref.fingerprint }, accountId: ref.accountId });
      return ref;
    } catch (error) {
      this.mapStoreError(error);
      throw error;
    }
  }

  async update(input: { adminId: string; credentialId: string; expectedVersion: number; provider?: string; alias?: string; label?: string; metadata?: Record<string, string>; requestId: string; traceId: string; bumpGeneration?: boolean }): Promise<CredentialRefView> {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new ServiceError(422, 'VALIDATION_FAILED', 'expectedVersion must be a positive integer');
    if (input.provider !== undefined && !input.provider.trim()) throw new ServiceError(422, 'VALIDATION_FAILED', 'provider is required');
    if (input.alias !== undefined && !input.alias.trim()) throw new ServiceError(422, 'VALIDATION_FAILED', 'alias is required');
    try {
      const ref = await this.store.updateCredentialRef(input);
      if (!ref) throw new ServiceError(404, 'NOT_FOUND', 'credential not found');
      if (ref.purpose === 'model_client' && input.bumpGeneration !== false) await this.store.bumpModelProviderConfigGeneration({ adminId: input.adminId, accountId: ref.accountId });
      await this.audit({ actorId: input.adminId, action: 'credential_ref.updated', targetRef: ref.id, requestId: input.requestId, traceId: input.traceId, payload: { provider: ref.provider, alias: ref.alias, version: ref.version }, accountId: ref.accountId });
      return ref;
    } catch (error) {
      this.mapStoreError(error);
      throw error;
    }
  }

  async rotate(input: { adminId: string; credentialId: string; expectedVersion: number; apiKey: string; requestId: string; traceId: string }): Promise<CredentialRefView> {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new ServiceError(422, 'VALIDATION_FAILED', 'expectedVersion must be a positive integer');
    this.validateApiKey(input.apiKey);
    try {
      const ref = await this.store.rotateCredentialRef({ adminId: input.adminId, credentialId: input.credentialId, expectedVersion: input.expectedVersion, secretCiphertext: encryptCredentialValue(input.apiKey, this.encryptionKey), fingerprint: credentialFingerprint(input.apiKey) });
      if (!ref) throw new ServiceError(404, 'NOT_FOUND', 'credential not found');
      if (ref.purpose === 'model_client') await this.store.bumpModelProviderConfigGeneration({ adminId: input.adminId, accountId: ref.accountId });
      await this.audit({ actorId: input.adminId, action: 'credential_ref.rotated', targetRef: ref.id, requestId: input.requestId, traceId: input.traceId, payload: { fingerprint: ref.fingerprint, version: ref.version }, accountId: ref.accountId });
      return ref;
    } catch (error) {
      this.mapStoreError(error);
      throw error;
    }
  }

  async setStatus(input: { adminId: string; credentialId: string; expectedVersion: number; status: CredentialRefStatus; requestId: string; traceId: string }): Promise<CredentialRefView> {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new ServiceError(422, 'VALIDATION_FAILED', 'expectedVersion must be a positive integer');
    if (!['active', 'disabled', 'revoked'].includes(input.status)) throw new ServiceError(422, 'VALIDATION_FAILED', 'invalid credential status');
    try {
      const ref = await this.store.updateCredentialRefStatus(input);
      if (!ref) throw new ServiceError(404, 'NOT_FOUND', 'credential not found');
      if (ref.purpose === 'model_client') await this.store.bumpModelProviderConfigGeneration({ adminId: input.adminId, accountId: ref.accountId });
      await this.audit({ actorId: input.adminId, action: `credential_ref.${input.status}`, targetRef: ref.id, requestId: input.requestId, traceId: input.traceId, payload: { status: ref.status, version: ref.version }, accountId: ref.accountId });
      return ref;
    } catch (error) {
      this.mapStoreError(error);
      throw error;
    }
  }

  private requireAccountId(accountId: string): void {
    if (!accountId.trim()) throw new ServiceError(422, 'VALIDATION_FAILED', 'accountId is required');
  }

  private validateKeyInput(input: { accountId: string; provider: string; alias: string; apiKey: string }): void {
    this.requireAccountId(input.accountId);
    if (!input.provider.trim() || !input.alias.trim()) throw new ServiceError(422, 'VALIDATION_FAILED', 'provider and alias are required');
    this.validateApiKey(input.apiKey);
  }

  private validateApiKey(apiKey: string): void {
    if (!apiKey.trim() || apiKey.trim().length < 8) throw new ServiceError(422, 'VALIDATION_FAILED', 'apiKey must contain at least 8 characters');
  }

  private mapStoreError(error: unknown): void {
    if (!(error instanceof Error)) return;
    if (error.message === 'ACCOUNT_SCOPE_FORBIDDEN') throw new ServiceError(403, 'FORBIDDEN', '当前管理员没有该账号的凭证权限');
    if (error.message === 'CREDENTIAL_VERSION_CONFLICT') throw new ServiceError(409, 'VERSION_CONFLICT', '凭证已被其他操作更新，请刷新后重试');
    if (error.message === 'CREDENTIAL_REVOKED') throw new ServiceError(409, 'CONFLICT', '凭证已撤销，不能恢复');
    if (error.message === 'CREDENTIAL_ALREADY_EXISTS' || (error as { code?: string }).code === '23505') throw new ServiceError(409, 'CONFLICT', '该账号已有模型 API Key 配置');
  }
}
