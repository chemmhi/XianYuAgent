/** These outcomes precede every external write and may be re-evaluated. */
export const RECOVERABLE_AUTOMATION_SKIP_REASONS: readonly string[] = Object.freeze(['rule_disabled', 'not_due_or_capped']);

export function isRecoverableAutomationSkip(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const value = result as { status?: unknown; reason?: unknown };
  return value.status === 'skipped' && typeof value.reason === 'string'
    && RECOVERABLE_AUTOMATION_SKIP_REASONS.includes(value.reason);
}
