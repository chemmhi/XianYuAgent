import type { AccountVM } from '../accounts/types';

export function chooseProductAccountId(accounts: AccountVM[], requestedAccountId?: string): string | undefined {
  const available = accounts.filter((account) => account.status !== 'disabled');
  if (requestedAccountId && available.some((account) => account.id === requestedAccountId)) return requestedAccountId;
  return available.find((account) => account.status === 'connected' || account.connection.status === 'online')?.id
    ?? available[0]?.id;
}
