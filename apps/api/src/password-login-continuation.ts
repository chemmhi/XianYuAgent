/** Official havana keepLoginSubmit posts the default continuation without enabling keep-login. */
export function passwordLoginContinuation(value: unknown): string | undefined {
  const root = record(value), content = record(root.content), data = record(content.data);
  if (root.hasError === true || content.success !== true || data.resultCode !== 100) return;
  if (!data.dialogAction) return;
  if (data.dialogAction !== 'keepLoginConfirm') throw new Error('PASSWORD_LOGIN_CONTINUATION_UNSUPPORTED');
  const raw = record(record(data.feedbackPayload).dynamicUrl).dialogDefaultLoginUrl;
  if (typeof raw !== 'string') throw new Error('PASSWORD_LOGIN_CONTINUATION_INVALID');
  let url: URL;
  try { url = new URL(raw, 'https://passport.goofish.com'); } catch { throw new Error('PASSWORD_LOGIN_CONTINUATION_INVALID'); }
  if (url.protocol !== 'https:' || url.hostname !== 'passport.goofish.com' || url.port || url.username || url.password
    || url.pathname !== '/login_token/login.do' || !url.searchParams.get('token')) throw new Error('PASSWORD_LOGIN_CONTINUATION_INVALID');
  return url.href;
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
