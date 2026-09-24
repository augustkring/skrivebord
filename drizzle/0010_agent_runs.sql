create table agent_run (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  agent_id uuid references agent_profile(id) on delete set null,
  runtime_type text not null default 'OPENCLAW',
  runtime_agent_key text not null,
  gateway_run_id text not null,
  session_key text not null,
  requested_by_principal_id text not null,
  route_context text,
  status text not null default 'ACCEPTED',
  accepted_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_run_gateway_unique unique(workspace_id, gateway_run_id)
);
create index agent_run_workspace_created_idx
  on agent_run(workspace_id, created_at desc);

alter table agent_run enable row level security;

create policy agent_run_isolation on agent_run
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));
