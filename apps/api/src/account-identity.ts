import type { AccountRecord, Store } from './domain.js';
import { ServiceError } from './services.js';

export async function assertCookieIdentity(store: Store, adminId: string, account: AccountRecord, sellerRef: string): Promise<void> {
  if (!(await store.isAccountIdentityAvailable(account.platform, sellerRef, account.id))) throw new ServiceError(409, 'ACCOUNT_IDENTITY_CONFLICT', '该闲鱼身份已绑定，请使用当前账号的 Cookie');
  const actor = await store.findAdminById(adminId);
  if (actor?.role !== 'admin' && account.sellerRef !== sellerRef && account.platformUserId !== sellerRef) throw new ServiceError(409, 'ACCOUNT_IDENTITY_MISMATCH', '重新授权必须使用当前闲鱼账号，请通过添加账号绑定其他身份');
}
