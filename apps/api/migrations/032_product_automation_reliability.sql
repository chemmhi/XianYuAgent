CREATE SCHEMA IF NOT EXISTS automation;

CREATE TABLE IF NOT EXISTS automation.execution_ledger (
  execution_key text PRIMARY KEY,
  fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed')),
  result_json jsonb,
  retryable boolean NOT NULL DEFAULT false,
  owner_token text,
  lease_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automation_execution_lease_idx
  ON automation.execution_ledger (status, lease_until);

CREATE TABLE IF NOT EXISTS automation.review_facts (
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  order_no text NOT NULL,
  event_id text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, order_no, event_id)
);

ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_review_reminder_at timestamptz;

ALTER TABLE orders.orders
  DROP CONSTRAINT IF EXISTS orders_review_reminder_count_check;

ALTER TABLE orders.orders
  ADD CONSTRAINT orders_review_reminder_count_check CHECK (review_reminder_count >= 0);

CREATE INDEX IF NOT EXISTS automation_review_facts_order_idx
  ON automation.review_facts (account_id, order_no, reviewed_at DESC);

DELETE FROM automation.review_facts older
USING automation.review_facts newer
WHERE older.account_id = newer.account_id
  AND older.order_no = newer.order_no
  AND (older.created_at > newer.created_at OR (older.created_at = newer.created_at AND older.ctid > newer.ctid));

CREATE UNIQUE INDEX IF NOT EXISTS automation_review_facts_order_unique
  ON automation.review_facts (account_id, order_no);
