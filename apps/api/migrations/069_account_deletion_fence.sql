ALTER TABLE accounts.accounts ADD COLUMN IF NOT EXISTS deletion_started_at timestamptz;
COMMENT ON COLUMN accounts.accounts.deletion_started_at IS 'Deletion requested; blocks login recovery while cleanup is pending. Original manager may retry.';

-- Existing repair rows are checked during account purge. New writes must never
-- recreate orphan conversation state after a concurrent account deletion.
ALTER TABLE public.auto_reply_conversation_state ADD CONSTRAINT repair_state_account_fk FOREIGN KEY(account_id) REFERENCES accounts.accounts(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.auto_reply_review_records ADD CONSTRAINT repair_review_account_fk FOREIGN KEY(account_id) REFERENCES accounts.accounts(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.auto_reply_review_events ADD CONSTRAINT repair_event_account_fk FOREIGN KEY(account_id) REFERENCES accounts.accounts(id) ON DELETE CASCADE NOT VALID;

-- Generated ownership also fences queue/ledger inserts made by an in-flight
-- worker. Non-account jobs keep NULL ownership and remain unaffected.
ALTER TABLE automation.execution_ledger ADD COLUMN account_id uuid GENERATED ALWAYS AS
  (CASE WHEN split_part(execution_key,':',2) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN split_part(execution_key,':',2)::uuid END) STORED;
ALTER TABLE automation.execution_ledger ADD CONSTRAINT execution_ledger_account_fk FOREIGN KEY(account_id) REFERENCES accounts.accounts(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE execution.outbox_jobs ADD COLUMN account_id uuid GENERATED ALWAYS AS
  (CASE WHEN coalesce(payload_json->>'accountId',payload_json#>>'{conversation,accountId}') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  THEN coalesce(payload_json->>'accountId',payload_json#>>'{conversation,accountId}')::uuid END) STORED;
ALTER TABLE execution.outbox_jobs ADD CONSTRAINT outbox_account_fk FOREIGN KEY(account_id) REFERENCES accounts.accounts(id) ON DELETE CASCADE NOT VALID;
