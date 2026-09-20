create table if not exists messages.auto_reply_runs (
  id uuid primary key,
  admin_id uuid not null references auth.admins(id),
  account_id uuid not null references accounts.accounts(id),
  conversation_id uuid not null references messages.conversations(id),
  inbound_message_id uuid not null references messages.messages(id),
  intent text not null,
  decision text not null check (decision in ('replied','handoff','skipped','failed')),
  status text not null check (status in ('received','classified','context_loaded','generated','simulated','persisted','handoff','skipped','failed')),
  risk_flags jsonb not null default '[]'::jsonb,
  product_id uuid null references products.products(id),
  order_refs jsonb not null default '[]'::jsonb,
  input_digest text not null,
  context_digest text null,
  reply_digest text null,
  sender_outcome text null check (sender_outcome in ('simulated','known_success','known_failure','unknown')),
  outbound_message_id uuid null references messages.messages(id),
  failure_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (admin_id, inbound_message_id)
);

create index if not exists auto_reply_runs_conversation_idx on messages.auto_reply_runs(conversation_id, created_at desc);
create index if not exists auto_reply_runs_account_idx on messages.auto_reply_runs(account_id, created_at desc);
