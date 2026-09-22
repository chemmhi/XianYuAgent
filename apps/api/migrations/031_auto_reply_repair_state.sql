-- AR-VS-08 compatibility migration: state and review records are additive.
-- The runtime keeps legacy auto_reply_runs readable; new tables are authoritative
-- for conversation state and review outcomes once the policy version is active.

create table if not exists auto_reply_conversation_state (
  state_id uuid primary key,
  account_id uuid not null,
  conversation_id uuid not null,
  state_version integer not null default 0,
  active_goal_id uuid,
  goal_status text not null,
  observed_stage text,
  target_stage text,
  emotion_snapshot jsonb,
  topic_relation text,
  pending_questions jsonb not null default '[]'::jsonb,
  clarification_round integer not null default 0,
  clarification_attempt_id text,
  last_question_fingerprint text,
  recommendation_state jsonb,
  awaiting_user boolean not null default false,
  awaiting_user_since timestamptz,
  awaiting_user_ttl timestamptz,
  last_message_id uuid,
  transition_at timestamptz not null,
  policy_version text,
  last_source_event_id text,
  last_source_sequence bigint not null default 0,
  processed_event_ids jsonb not null default '[]'::jsonb,
  processed_idempotency_keys jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, conversation_id)
);

create table if not exists auto_reply_review_records (
  review_id uuid primary key,
  account_id uuid not null,
  conversation_id uuid not null,
  run_id uuid not null,
  goal_id uuid not null,
  state_id uuid not null,
  review_type text not null,
  decision text,
  resolution_status text not null,
  reason_codes jsonb not null default '[]'::jsonb,
  evidence_refs jsonb not null default '[]'::jsonb,
  evidence_types jsonb not null default '[]'::jsonb,
  evidence_window_start timestamptz,
  evidence_window_end timestamptz,
  reviewer_source text not null,
  attempt integer not null default 0,
  claim_key text,
  lease_owner text,
  lease_expires_at timestamptz,
  idempotency_key text not null,
  reviewed_at timestamptz,
  next_review_at timestamptz,
  next_action text,
  override_by uuid,
  override_rejected boolean not null default false,
  expected_state_version integer not null,
  supersedes_review_id uuid,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, idempotency_key)
);

create index if not exists idx_auto_reply_review_claimable
  on auto_reply_review_records (resolution_status, lease_expires_at, next_review_at);
create index if not exists idx_auto_reply_review_scope
  on auto_reply_review_records (account_id, conversation_id, created_at desc);

create table if not exists auto_reply_review_events (
  event_id uuid primary key,
  review_id uuid not null references auto_reply_review_records(review_id),
  account_id uuid not null,
  conversation_id uuid not null,
  event_type text not null,
  source_event_id text not null,
  source_sequence bigint not null,
  state_version integer not null,
  policy_version text not null,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  unique (account_id, conversation_id, idempotency_key)
);
