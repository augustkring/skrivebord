alter table workspace_profile
  add constraint workspace_profile_organization_fk
  foreign key (workspace_id) references organization(id) on delete cascade;

alter table agent_credential_binding
  add constraint agent_credential_apikey_fk
  foreign key (api_key_id) references apikey(id) on delete cascade;
