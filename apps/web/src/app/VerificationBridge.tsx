import { useMemo, type ReactNode } from 'react';
import { useAccountContext } from './account-context';
import { VerificationProvider } from '../features/verification/VerificationProvider';
import type { VerificationTransport } from '../features/verification/api';
export function AccountVerificationProvider({ transport, baseUrl, children }: { transport: VerificationTransport; baseUrl: string; children: ReactNode }) {
  const { accounts } = useAccountContext();
  const accountLabels = useMemo(() => Object.fromEntries(accounts.map(account => [account.id, account.displayName])), [accounts]);
  return <VerificationProvider transport={transport} baseUrl={baseUrl} accountLabels={accountLabels}>{children}</VerificationProvider>;
}
