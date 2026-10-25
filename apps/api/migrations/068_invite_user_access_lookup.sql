-- Existing and new activated invitations are checked for each user request/realtime frame.
-- Non-unique intentionally: ambiguous grants fail closed in the application.
CREATE INDEX IF NOT EXISTS registration_invites_used_by_idx
  ON auth.registration_invites (used_by) WHERE used_at IS NOT NULL;

-- Rollback: DROP INDEX IF EXISTS auth.registration_invites_used_by_idx;
