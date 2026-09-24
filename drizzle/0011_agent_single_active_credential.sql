create unique index agent_credential_one_active_per_agent
  on agent_credential_binding(workspace_id, agent_id)
  where enabled = true and revoked_at is null;
