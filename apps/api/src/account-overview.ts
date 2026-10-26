import type { AccountRecord } from './domain.js';
import type { AutoReplyAgentSettingsService } from './auto-reply-agent-settings.js';
import { connectionView } from './account-connection.js';

export async function accountOverviews(accounts: AccountRecord[], adminId: string, settings: Pick<AutoReplyAgentSettingsService, 'enabledForAccounts'>) {
  // A single scoped read preserves tombstones without making a setting read
  // per account on the three-second list refresh. No prompt is loaded here.
  const enabled = await settings.enabledForAccounts(adminId, accounts.filter(account => account.status !== 'disabled').map(account => account.id));
  return accounts.map(account => ({ ...account, displayName: account.displayName?.trim() || '闲鱼账号',
    autoReplyEnabled: enabled.get(account.id) ?? null, connection: connectionView(account) }));
}
