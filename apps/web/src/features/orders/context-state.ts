/**
 * A failed initial account lookup must not leave the orders surface in its
 * controller's idle phase forever. That phase is reserved for the sentinel
 * account context while the provider is still resolving.
 */
export function hasOrdersContextLoadFailure(accountsError: string | null, currentAccountId?: string): boolean {
  return Boolean(accountsError && !currentAccountId);
}
