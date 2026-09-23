-- AR-VS-07: persist Outcome Review lifecycle timestamps for close/reopen audit.
alter table if exists auto_reply_review_records
  add column if not exists resolved_at timestamptz,
  add column if not exists closed_at timestamptz;
