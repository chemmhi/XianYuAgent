-- AR-RA-023 account-scoped ACTIVE repair policy registry.
-- Policy JSON is immutable per version; lifecycle status is stored separately
-- so retiring/rolling back a version never changes the hash-protected payload.

CREATE SCHEMA IF NOT EXISTS settings;

CREATE TABLE IF NOT EXISTS settings.auto_reply_repair_policies (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  policy_version text NOT NULL,
  policy_hash text NOT NULL,
  lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('ACTIVE', 'RETIRED', 'ROLLBACK_TARGET')),
  policy_json jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  published_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, policy_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS auto_reply_repair_policies_active_idx
  ON settings.auto_reply_repair_policies (account_id)
  WHERE lifecycle_status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS auto_reply_repair_policies_lookup_idx
  ON settings.auto_reply_repair_policies (account_id, lifecycle_status, effective_from DESC);
