-- Allow one OpenAI-compatible primary and one backup configuration per account.
-- Configuration-specific fields remain in credential_values.metadata_json so the
-- existing CredentialStore encryption and redacted reference contract stay intact.
ALTER TABLE accounts.credential_refs
  DROP CONSTRAINT IF EXISTS credential_refs_account_id_kind_purpose_key;
