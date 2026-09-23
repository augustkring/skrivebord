alter table action_intent
  add column approved_at timestamptz,
  add column approved_by_principal_id text;
