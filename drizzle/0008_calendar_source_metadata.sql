alter table calendar_source
  add column is_primary boolean not null default false,
  add column access_role text;

create unique index calendar_source_one_primary_per_account
  on calendar_source(workspace_id, connector_account_id)
  where is_primary = true;
