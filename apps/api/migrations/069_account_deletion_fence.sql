ALTER TABLE accounts.accounts ADD COLUMN IF NOT EXISTS deletion_started_at timestamptz;
COMMENT ON COLUMN accounts.accounts.deletion_started_at IS 'Deletion requested; blocks login recovery while cleanup is pending. Original manager may retry.';

-- Existing repair rows are checked during account purge. New writes must never
-- recreate orphan conversation state after a concurrent account deletion.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.auto_reply_conversation_state'::regclass AND conname='repair_state_account_fk') THEN
    ALTER TABLE public.auto_reply_conversation_state ADD CONSTRAINT repair_state_account_fk FOREIGN KEY(account_id) REFERENCES accounts.accounts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$migration$;
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.auto_reply_review_records'::regclass AND conname='repair_review_account_fk') THEN
    ALTER TABLE public.auto_reply_review_records ADD CONSTRAINT repair_review_account_fk FOREIGN KEY(account_id) REFERENCES accounts.accounts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$migration$;
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.auto_reply_review_events'::regclass AND conname='repair_event_account_fk') THEN
    ALTER TABLE public.auto_reply_review_events ADD CONSTRAINT repair_event_account_fk FOREIGN KEY(account_id) REFERENCES accounts.accounts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$migration$;

-- Generated ownership also fences queue/ledger inserts made by an in-flight
-- worker. Non-account jobs keep NULL ownership and remain unaffected.
ALTER TABLE automation.execution_ledger ADD COLUMN IF NOT EXISTS account_id uuid GENERATED ALWAYS AS
  (CASE WHEN split_part(execution_key,':',2) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN split_part(execution_key,':',2)::uuid END) STORED;
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='automation.execution_ledger'::regclass AND conname='execution_ledger_account_fk') THEN
    ALTER TABLE automation.execution_ledger ADD CONSTRAINT execution_ledger_account_fk FOREIGN KEY(account_id) REFERENCES accounts.accounts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$migration$;
ALTER TABLE execution.outbox_jobs ADD COLUMN IF NOT EXISTS account_id uuid GENERATED ALWAYS AS
  (CASE WHEN coalesce(payload_json->>'accountId',payload_json#>>'{conversation,accountId}') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  THEN coalesce(payload_json->>'accountId',payload_json#>>'{conversation,accountId}')::uuid END) STORED;
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='execution.outbox_jobs'::regclass AND conname='outbox_account_fk') THEN
    ALTER TABLE execution.outbox_jobs ADD CONSTRAINT outbox_account_fk FOREIGN KEY(account_id) REFERENCES accounts.accounts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$migration$;
