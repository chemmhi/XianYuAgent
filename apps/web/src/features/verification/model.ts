export type VerificationState = 'preparing' | 'priority_wait' | 'human_active' | 'auto_active' | 'settling' | 'handoff' | 'rechecking' | 'succeeded' | 'completed_partial' | 'failed' | 'expired' | 'cancelled';
export interface VerificationSession {
  id: string; subject: { accountId?: string; loginSessionId?: string }; state: VerificationState;
  mode: 'manual_only' | 'manual_then_auto'; autoAllowed: boolean; version: number; eventSequence: number;
  createdAt: number; expiresAt: number; setupDeadline: number; priorityDeadline?: number; humanDeadline?: number; reconnectDeadline?: number;
  controlEpoch: number; autoAttempts: number; challengeGeneration: number;
  presentationKind?: 'native_iframe'; resultCandidateReceived?: boolean;
  controller?: { clientId: string }; presentation?: { clientId: string; until: number };
  failureCode?: string; executionOutcome?: string; actions: string[]; serverTime: number;
  platformResult?: { status: 'accepted' | 'rejected'; code: number; sequence: number; challengeGeneration: number; observedAt: number };
  sourceResults: Array<{ source: string; status: string; nextAction?: string }>;
  accountHealth?: { status: string; transportStatus?: string; transportSeenAt?: string; riskSources: string[] };
}
export interface VerificationFrame {
  frameId: string; streamEpoch: number; geometryRevision: number; capturedAt: number;
  width: number; height: number; byteLength: number;
}
export const terminal = (s: VerificationSession) => ['succeeded', 'completed_partial', 'failed', 'expired', 'cancelled'].includes(s.state);
export function mergeSession(rows: VerificationSession[], next: VerificationSession): VerificationSession[] {
  const current = rows.find(row => row.id === next.id);
  if (current && current.eventSequence > next.eventSequence) return rows;
  return [...rows.filter(row => row.id !== next.id), next].sort((a, b) => a.createdAt - b.createdAt);
}
export interface PendingVerificationSelection {
  subject: VerificationSession['subject'];
  knownTerminalIds: string[];
}
export function sameVerificationSubject(a: VerificationSession['subject'], b: VerificationSession['subject']): boolean {
  return a.accountId ? a.accountId === b.accountId && !b.loginSessionId
    : Boolean(a.loginSessionId && a.loginSessionId === b.loginSessionId && !b.accountId);
}
export function controlledVerificationSession(rows: VerificationSession[], clientId: string): VerificationSession | undefined {
  return clientId ? rows.find(row => row.state === 'human_active' && row.controller?.clientId === clientId) : undefined;
}
export function pendingVerificationSelection(rows: VerificationSession[], subject: VerificationSession['subject']): PendingVerificationSelection {
  return { subject: { ...subject }, knownTerminalIds: rows.filter(row => terminal(row) && sameVerificationSubject(row.subject, subject)).map(row => row.id) };
}
export function projectVerificationSelection(rows: VerificationSession[], selected: string | undefined, clientId: string,
  pending?: PendingVerificationSelection, retainedSelection?: string): { selected: string | undefined; pending?: PendingVerificationSelection; retainedSelection?: string } {
  const controlled = controlledVerificationSession(rows, clientId);
  if (controlled) return { selected: controlled.id, pending: pending && sameVerificationSubject(controlled.subject, pending.subject) ? undefined : pending, retainedSelection };
  if (pending) {
    const matching = rows.filter(row => sameVerificationSubject(row.subject, pending.subject) && !pending.knownTerminalIds.includes(row.id))
      .sort((a, b) => b.createdAt - a.createdAt);
    const requested = matching.find(row => !terminal(row)) ?? matching[0];
    if (requested) return { selected: requested.id, retainedSelection: requested.id };
  }
  if (retainedSelection && rows.some(row => row.id === retainedSelection)) return { selected: retainedSelection, pending, retainedSelection };
  const current = rows.find(row => row.id === selected);
  return { selected: current && !terminal(current) ? current.id : rows.find(row => !terminal(row))?.id ?? current?.id, pending };
}
export function countdown(session: VerificationSession, now: number): number {
  const deadline = session.state === 'human_active' ? session.humanDeadline : session.state === 'priority_wait' ? session.priorityDeadline : undefined;
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
}
export function stateLabel(state: VerificationState): string {
  return { preparing: '正在准备验证画面', priority_wait: '请确认是否由你操作', human_active: '由你操作验证', auto_active: '系统正在尝试验证', settling: '正在确认刚才的操作结果', handoff: '验证码已通过，正在交接', rechecking: '正在检查账号连接', succeeded: '本轮验证已完成', completed_partial: '验证部分完成', failed: '本轮验证未完成', expired: '验证会话已过期', cancelled: '验证已取消' }[state];
}
export function failureLabel(code?: string): string {
  if (code === 'VERIFICATION_NATIVE_HUMAN_RESULT_UNKNOWN') return '人工操作结果尚未确认，本轮已停止，请人工重试。';
  if (code?.startsWith('VERIFICATION_NATIVE_APPLY')) return '验证结果交接未完成，请人工重试或重新扫码授权。';
  if (code === 'VERIFICATION_PLATFORM_REJECTED') return '平台未通过本次验证，请人工重试或重新扫码授权。';
  if (code?.includes('PRESENTATION_NOT_READY')) return '验证画面尚未就绪，本轮未开始人工操作。请重新获取画面。';
  if (code?.includes('BUDGET')) return '自动尝试已达上限，请选择人工重试或重新扫码授权。';
  if (code?.includes('HANDOFF') || code?.includes('RECHECK')) return '验证码已通过，连接检查未完成。账号仍需处理，请查看具体状态。';
  if (code?.includes('WAITING_FOR_HUMAN')) return '本轮仅限人工处理，未运行自动操作。你可以再次选择“重试”。';
  if (code?.includes('OWNER') || code?.includes('UNAVAILABLE') || code?.includes('RELEASE')) return '验证连接已停止，请重新发起验证。';
  if (code?.includes('UNKNOWN')) return '平台结果尚未确认，本轮已停止，请先核对账号状态。';
  return '本轮未确认账号恢复，请人工重试或重新扫码授权。';
}
export function normalizedPoint(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, clientX: number, clientY: number) {
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  return { x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) };
}
export function panelVisible(element: HTMLElement | null): boolean {
  if (!element || document.visibilityState !== 'visible' || !document.hasFocus()) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent);
    if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) === 0) return false;
  }
  return [0.1, 0.5, 0.9].every(x => [0.1, 0.5, 0.9].every(y => {
    const top = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
    return Boolean(top && element.contains(top));
  }));
}
