import type { Store } from './domain.js';
import { ServiceError } from './services.js';

/** Origins are trusted server configuration; invited users cannot add destinations. */
export class InvitedUserModelPolicy {
  private readonly origins: Set<string>;
  constructor(private readonly store: Store, origins = process.env.INVITED_USER_MODEL_ORIGINS ?? 'https://api.openai.com') {
    this.origins = new Set(origins.split(',').map(value => value.trim()).filter(Boolean).map(value => {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('INVITED_USER_MODEL_ORIGINS must contain trusted HTTPS origins');
      return url.origin;
    }));
  }
  async restricted(adminId: string, config: { baseUrl: string; probeUrl?: string }): Promise<boolean> {
    const actor = await this.store.findAdminById(adminId);
    if (actor?.role === 'admin' && actor.status === 'active') return false;
    if (!actor || actor.status !== 'active') throw new ServiceError(403, 'FORBIDDEN', '用户不可用');
    this.assertUrl(config.baseUrl);
    if (config.probeUrl) this.assertUrl(config.probeUrl);
    return true;
  }
  private assertUrl(value: string): void {
    let url: URL;
    try { url = new URL(value); } catch { throw new ServiceError(422, 'MODEL_ORIGIN_NOT_ALLOWED', '请选择管理员允许的模型服务地址'); }
    if (url.protocol !== 'https:' || url.username || url.password || !this.origins.has(url.origin)) throw new ServiceError(403, 'MODEL_ORIGIN_NOT_ALLOWED', '该模型服务地址尚未获得平台管理员授权');
  }
  fetch(fetchImpl: typeof fetch): typeof fetch {
    return async (input, init) => {
      this.assertUrl(input instanceof Request ? input.url : String(input));
      return fetchImpl(input, { ...init, redirect: 'error' });
    };
  }
}
