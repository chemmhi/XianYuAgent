const accountErrorLabels: Record<string, string> = {
  ACCOUNT_VALIDATION_REQUIRED: '需要安全验证，请在闲鱼完成验证后重新授权。',
  ACCOUNT_REAUTH_REQUIRED: '登录已过期，请重新授权账号。',
  SESSION_EXPIRED: '登录已过期，请重新登录。',
  CREDENTIAL_MISSING: '缺少登录凭证，请重新授权账号。',
  MTOP_TOKEN_EXPIRED: '登录凭证已过期，请重新授权账号。',
  MTOP_TOKEN_MISSING: '缺少登录凭证，请重新授权账号。',
  ACCOUNT_CONTEXT_INVALID: '该账号不可用，请刷新列表后重新选择。',
  ACCOUNT_DELETE_UNAVAILABLE: '账号删除服务暂不可用，请稍后重试。',
  ACCOUNT_MUTATION_UNAVAILABLE: '账号操作服务暂不可用，请稍后重试。',
  PASSWORD_LOGIN_UNAVAILABLE: '密码登录服务暂不可用，请稍后重试。',
  PASSWORD_REJECTED: '账号或密码错误，请核对后重试。',
  PASSWORD_ACCOUNT_MISMATCH: '登录账号与当前账号不一致，请使用对应账号登录。',
  PASSWORD_LOGIN_EXPIRED: '登录超时，请重新登录并完成安全验证。',
  PASSWORD_LOGIN_BUSY: '该账号正在登录，请稍后重试。',
  PASSWORD_LOGIN_INTERRUPTED: '登录已中断，请重新提交。',
  PASSWORD_TERMS_REQUIRED: '请先阅读并同意闲鱼登录协议。',
  PASSWORD_ENCRYPTION_KEY_REQUIRED: '服务尚未配置凭证加密密钥，请联系管理员。',
  PASSWORD_LOGIN_COMMITTING: '登录已验证，正在保存授权，请稍候。',
  PASSWORD_SECRET_SAVE_FAILED: '登录授权已更新，但新账密保存失败，原自动登录设置保留，请重试。',
  PASSWORD_SECRET_MISSING: '该账号尚未保存账密，请填写账号密码登录。',
  PASSWORD_DEVICE_SDK_NOT_READY: '官方设备组件尚未就绪，请稍后重试。',
  PASSWORD_DEVICE_INIT_FAILED: '官方设备环境启动失败，请检查服务运行环境。',
  PASSWORD_DEVICE_SIGNATURE_TIMEOUT: '官方设备组件生成请求参数超时，请重试。',
  PASSWORD_SECURITY_VERIFICATION_REQUIRED: '闲鱼要求安全验证，本次自动登录已暂停。',
  PASSWORD_IV_EXPIRED: '官方验证已过期，请重新登录。',
  PASSWORD_IV_RESPONSE_UNSUPPORTED: '官方验证步骤暂未识别，请稍后重试。',
  COOKIE_VERIFY_FAILED: '登录凭证校验失败，请复制最新完整 Cookie 后重试。',
  COOKIE_LOGIN_FAILED: 'Cookie 登录失败，请检查凭证后重试。',
  QR_GENERATE_FAILED: '二维码生成失败，请关闭弹窗后重新打开。',
  QR_ACCOUNT_MISMATCH: '扫码账号与当前账号不一致，请使用对应账号重新扫码。',
  QR_LOGIN_UNAVAILABLE: '二维码登录暂不可用，请稍后重试。',
  QR_EXPIRED: '二维码已过期，请关闭弹窗后重新扫码。',
  FORBIDDEN: '当前账号没有操作权限。',
  NOT_FOUND: '账号或通知已不存在，请刷新后重试。',
};

export function accountRiskLabel(code?: string): string {
  if (/CAPTCHA|SLIDER|X5SEC|RGV587|FAIL_SYS_USER_VALIDATE/i.test(code ?? '')) return '需滑块验证';
  return '需要安全验证';
}

/** Raw codes/messages stay in API diagnostics, never in product copy. */
export function accountErrorMessage(error: unknown, fallback: string): string {
  const record = error && typeof error === 'object' ? error as { status?: number; message?: string; payload?: { error?: { code?: string; details?: { errorCode?: string } } } } : undefined;
  const codes = [record?.payload?.error?.details?.errorCode, record?.payload?.error?.code, record?.message];
  for (const code of codes) {
    if (!code) continue;
    if (Object.hasOwn(accountErrorLabels, code)) return accountErrorLabels[code];
    if (/CAPTCHA|SLIDER|X5SEC|RGV587|FAIL_SYS_USER_VALIDATE/i.test(code)) return '需要安全验证，请在闲鱼完成验证后重新授权。';
  }
  if (record?.status === 401) return '登录已过期，请重新登录。';
  if (record?.status === 403) return '当前账号没有操作权限。';
  if (record?.status === 404) return '账号或通知已不存在，请刷新后重试。';
  if (record?.status === 429) return '操作过于频繁，请稍后重试。';
  if (record?.status === 504) return '请求超时，请稍后重试。';
  if (error instanceof TypeError) return '账号服务暂时不可用，请检查连接后重试。';
  return fallback;
}
