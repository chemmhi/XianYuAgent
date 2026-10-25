import type { AdminRecord, InviteAccessStatus, InviteRecord, Store } from './domain.js';

/** Activation and access are separate: a used code never becomes registerable again. */
export function inviteAccessStatus(invite: Pick<InviteRecord, 'disabledAt' | 'revokedAt' | 'deletedAt' | 'expiresAt'>, now = Date.now()): InviteAccessStatus {
  if (invite.disabledAt || invite.revokedAt || invite.deletedAt) return 'disabled';
  const expiresAt = Date.parse(invite.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now ? 'expired' : 'active';
}

export async function actorInviteAccess(store: Store, actor: AdminRecord): Promise<InviteAccessStatus | 'missing'> {
  if (actor.role === 'admin') return 'active';
  const invite = await store.findInviteByUsedBy(actor.id);
  if (!invite || !invite.usedAt || invite.usedBy !== actor.id) return 'missing';
  return inviteAccessStatus(invite);
}
