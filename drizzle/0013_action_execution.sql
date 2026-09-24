create table action_execution (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  action_intent_id uuid not null references action_intent(id) on delete cascade,
  idempotency_key text not null,
  parameters_digest text not null,
  state action_state not null default 'PENDING',
  attempt_count integer not null default 1,
  result_json jsonb,
  external_effect_refs_json jsonb not null default '[]'::jsonb,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint action_execution_intent_unique unique(action_intent_id),
  constraint action_execution_idempotency_unique unique(workspace_id, idempotency_key)
);

create index action_execution_workspace_state_idx
  on action_execution(workspace_id, state);

alter table action_execution enable row level security;

create policy action_execution_isolation
  on action_execution
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));
