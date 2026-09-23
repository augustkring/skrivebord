alter table action_intent
  add column idempotency_key text;

create unique index action_intent_workspace_idempotency_unique
  on action_intent(workspace_id, idempotency_key)
  where idempotency_key is not null;
