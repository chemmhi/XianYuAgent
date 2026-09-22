export function buildAccountsReauthorizePath(accountId?: string): string {
  const params = new URLSearchParams();
  if (accountId?.trim()) params.set('reauthorize', accountId.trim());
  const query = params.toString();
  return query ? `/accounts?${query}` : '/accounts';
}

export function readReauthorizeAccountId(search: string): string | undefined {
  const value = new URLSearchParams(search).get('reauthorize')?.trim();
  return value || undefined;
}

export function findReauthorizeAccount<T extends { id: string }>(accounts: T[], requestedAccountId?: string): T | undefined {
  if (!requestedAccountId) return undefined;
  return accounts.find((account) => account.id === requestedAccountId);
}
