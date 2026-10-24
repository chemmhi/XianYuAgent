import type { AccountRecord, CredentialRecord } from './domain.js';
import type { XianyuImCredential } from './xianyu-im.js';
import type { XianyuMtopClient } from './xianyu-mtop.js';
import { ServiceError } from './services.js';

/** Replay only the session requests observed on /im, without launching Chrome. */
export async function refreshXianyuChatRequests(
  mtop: XianyuMtopClient,
  adminId: string,
  account: AccountRecord,
  credential: CredentialRecord,
): Promise<XianyuImCredential & { metadata: Record<string, string> }> {
  const options = { referer: 'https://www.goofish.com/im' };
  const session = mtop.createCredentialSession(adminId, account.id, credential);
  const login = await session.client.verifyLogin(adminId, account.id, options);
  if (!login.success) throw new ServiceError(login.accountInvalid ? 409 : 502,
    login.errorCode ?? 'XIANYU_CHAT_LOGIN_FAILED', '聊天会话登录检查失败');
  const expectedUserId = account.platformUserId ?? account.sellerRef;
  const data = login.response?.data as { userId?: unknown } | undefined;
  if (!expectedUserId || String(data?.userId ?? '') !== expectedUserId) {
    throw new ServiceError(409, 'XIANYU_CHAT_IDENTITY_MISMATCH', '聊天会话账号与当前账号不匹配');
  }
  const deviceId = credential.deviceId ?? `xianyu-${account.id}`;
  const token = await session.client.fetchImToken(adminId, account.id, deviceId, options);
  if (!token.success || !token.accessToken) throw new ServiceError(token.accountInvalid ? 409 : 502,
    token.errorCode ?? 'IM_TOKEN_MISSING', '聊天会话 token 更新失败');
  return { cookieHeader: token.cookieHeader, accessToken: token.accessToken, deviceId, metadata: session.getCredential().metadata ?? {} };
}
