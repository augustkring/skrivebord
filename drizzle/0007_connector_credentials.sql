create table connector_credential (
  connector_account_id uuid primary key references connector_account(id) on delete cascade,
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  encrypted_payload text not null,
  key_id text not null,
  expires_at timestamptz,
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table connector_credential enable row level security;

create policy connector_credential_system_select
  on connector_credential
  for select
  using (
    workspace_id = current_setting('app.workspace_id', true)
    and current_setting('app.principal_type', true) = 'SYSTEM'
  );

create policy connector_credential_system_insert
  on connector_credential
  for insert
  with check (
    workspace_id = current_setting('app.workspace_id', true)
    and current_setting('app.principal_type', true) = 'SYSTEM'
  );

create policy connector_credential_system_update
  on connector_credential
  for update
  using (
    workspace_id = current_setting('app.workspace_id', true)
    and current_setting('app.principal_type', true) = 'SYSTEM'
  )
  with check (
    workspace_id = current_setting('app.workspace_id', true)
    and current_setting('app.principal_type', true) = 'SYSTEM'
  );

create policy connector_credential_system_delete
  on connector_credential
  for delete
  using (
    workspace_id = current_setting('app.workspace_id', true)
    and current_setting('app.principal_type', true) = 'SYSTEM'
  );
