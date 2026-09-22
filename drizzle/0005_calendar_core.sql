create table connector_account (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  provider text not null,
  display_name text not null,
  provider_account_id text not null,
  status text not null default 'CONNECTED',
  scopes_json jsonb not null default '[]'::jsonb,
  connected_by text not null,
  connected_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connector_account_provider_unique
    unique(workspace_id, provider, provider_account_id)
);
create index connector_account_workspace_idx
  on connector_account(workspace_id);

create table calendar_source (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  provider text not null,
  connector_account_id uuid references connector_account(id) on delete cascade,
  provider_calendar_id text not null,
  display_name text not null,
  writable boolean not null default false,
  sync_state text not null default 'CONNECTED',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_source_provider_unique
    unique(workspace_id, provider, provider_calendar_id)
);
create index calendar_source_workspace_idx
  on calendar_source(workspace_id);

create table calendar_event (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  calendar_source_id uuid not null references calendar_source(id) on delete cascade,
  provider_event_id text not null,
  provider_version text,
  title text not null,
  description_sanitized text,
  start_at timestamptz,
  end_at timestamptz,
  start_date date,
  end_date date,
  all_day boolean not null default false,
  timezone text,
  recurrence_master_id text,
  recurrence_rule text,
  status text not null default 'CONFIRMED',
  category text not null,
  property_id uuid references property(id) on delete set null,
  booking_id uuid references booking(id) on delete set null,
  origin_actor_type principal_type not null default 'SYSTEM',
  origin_actor_id text,
  source_updated_at timestamptz,
  normalized_at timestamptz not null default now(),
  local_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_event_provider_unique
    unique(workspace_id, calendar_source_id, provider_event_id),
  constraint calendar_event_time_shape_check check (
    (all_day = true and start_date is not null and start_at is null)
    or
    (all_day = false and start_at is not null and start_date is null)
  )
);
create index calendar_event_workspace_time_idx
  on calendar_event(workspace_id, start_at);
create index calendar_event_workspace_date_idx
  on calendar_event(workspace_id, start_date);

create table sync_cursor (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  connector_account_id uuid not null references connector_account(id) on delete cascade,
  resource_type text not null,
  resource_scope text not null,
  cursor_type text not null,
  cursor_value_protected text not null,
  valid_from timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sync_cursor_resource_unique
    unique(workspace_id, connector_account_id, resource_type, resource_scope)
);

create table sync_run (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  connector_account_id uuid not null references connector_account(id) on delete cascade,
  mode text not null,
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  items_seen integer not null default 0,
  items_created integer not null default 0,
  items_updated integer not null default 0,
  items_deleted integer not null default 0,
  failure_code text
);
create index sync_run_workspace_started_idx
  on sync_run(workspace_id, started_at);

alter table connector_account enable row level security;
alter table calendar_source enable row level security;
alter table calendar_event enable row level security;
alter table sync_cursor enable row level security;
alter table sync_run enable row level security;

create policy connector_account_isolation on connector_account
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));

create policy calendar_source_isolation on calendar_source
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));

create policy calendar_event_isolation on calendar_event
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));

create policy sync_cursor_isolation on sync_cursor
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));

create policy sync_run_isolation on sync_run
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));
