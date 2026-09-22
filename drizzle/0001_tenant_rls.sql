-- Defense-in-depth tenant isolation.
-- The application Principal Resolver is still the primary authorization boundary.
-- Application traffic must use a role without BYPASSRLS.

alter table workspace_profile enable row level security;
alter table agent_profile enable row level security;
alter table agent_credential_binding enable row level security;
alter table booking enable row level security;
alter table work_item enable row level security;
alter table action_intent enable row level security;
alter table approval_request enable row level security;
alter table audit_event enable row level security;

create policy workspace_profile_isolation on workspace_profile
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));

create policy agent_profile_isolation on agent_profile
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));

create policy agent_credential_binding_isolation on agent_credential_binding
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));

create policy booking_isolation on booking
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));

create policy work_item_isolation on work_item
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));

create policy action_intent_isolation on action_intent
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));

create policy approval_request_isolation on approval_request
  for all
  using (workspace_id = current_setting('app.workspace_id', true))
  with check (workspace_id = current_setting('app.workspace_id', true));

create policy audit_event_select_isolation on audit_event
  for select
  using (workspace_id = current_setting('app.workspace_id', true));

create policy audit_event_insert_isolation on audit_event
  for insert
  with check (workspace_id = current_setting('app.workspace_id', true));

revoke update, delete on audit_event from public;
