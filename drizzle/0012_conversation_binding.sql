create table conversation_binding (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  agent_id uuid not null references agent_profile(id) on delete cascade,
  context_type text not null,
  context_id uuid,
  openclaw_session_key text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  constraint conversation_binding_context_shape check (
    (context_type = 'GENERAL' and context_id is null)
    or
    (context_type in ('BOOKING', 'PROPERTY') and context_id is not null)
  ),
  constraint conversation_binding_session_unique
    unique(workspace_id, openclaw_session_key)
);

create unique index conversation_binding_context_unique
  on conversation_binding (
    workspace_id,
    agent_id,
    context_type,
    coalesce(context_id::text, '')
  );

create index conversation_binding_workspace_agent_idx
  on conversation_binding(workspace_id, agent_id);

alter table conversation_binding enable row level security;

create policy conversation_binding_isolation
  on conversation_binding
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));
