create table property (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  name text not null,
  address_json jsonb not null default '{}'::jsonb,
  timezone text not null default 'Europe/Copenhagen',
  active boolean not null default true,
  external_refs_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index property_workspace_idx on property(workspace_id);

alter table booking
  add constraint booking_property_fk
  foreign key (property_id) references property(id) on delete restrict;

create table year_plan_item (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  module_id text not null default 'rental',
  property_id uuid references property(id) on delete set null,
  title text not null,
  description text not null,
  month integer not null check (month between 1 and 12),
  window_start_day integer not null check (window_start_day between 1 and 31),
  window_end_day integer not null check (window_end_day between 1 and 31),
  recurrence_rule text,
  action_template_id text,
  default_owner_type text,
  default_owner_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index year_plan_workspace_month_idx
  on year_plan_item(workspace_id, month);

alter table property enable row level security;
alter table year_plan_item enable row level security;

create policy property_isolation on property
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));

create policy year_plan_item_isolation on year_plan_item
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));
