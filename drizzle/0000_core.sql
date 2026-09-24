create extension if not exists pgcrypto;

create type principal_type as enum ('HUMAN', 'AGENT', 'SYSTEM');
create type approval_state as enum ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED', 'CONSUMED', 'SUPERSEDED');
create type action_state as enum ('PENDING', 'WAITING_APPROVAL', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'ROLLED_BACK');

create table workspace_profile (
  workspace_id text primary key,
  slug text not null unique,
  display_name text not null,
  locale text not null default 'da-DK',
  timezone text not null default 'Europe/Copenhagen',
  week_starts_on integer not null default 1,
  brand_config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table agent_profile (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  name text not null,
  runtime_type text not null default 'OPENCLAW',
  runtime_agent_key text not null,
  enabled boolean not null default true,
  status text not null default 'UNKNOWN',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_workspace_idx on agent_profile(workspace_id);

create table booking (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  property_id uuid not null,
  external_source text not null,
  external_id text not null,
  guest_display_name text not null,
  check_in_at timestamptz not null,
  check_out_at timestamptz not null,
  status text not null,
  source_updated_at timestamptz,
  normalized_at timestamptz not null default now(),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_external_unique unique(workspace_id, external_source, external_id)
);
create index booking_workspace_idx on booking(workspace_id);

create table work_item (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  module_id text not null,
  kind text not null,
  title text not null,
  reason text not null,
  status text not null,
  priority_class text not null,
  due_at timestamptz,
  evidence_json jsonb not null default '[]'::jsonb,
  suggested_action_id text,
  agent_execution_mode text not null,
  dedupe_fingerprint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint work_item_dedupe_unique unique(workspace_id, dedupe_fingerprint)
);

create table action_intent (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  action_id text not null,
  requested_by_principal_id text not null,
  requested_by_principal_type principal_type not null,
  target_type text,
  target_id text,
  parameters_json jsonb not null,
  parameters_digest text not null,
  human_summary text not null,
  risk_level text not null,
  policy_decision text not null,
  state action_state not null default 'PENDING',
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index action_intent_workspace_idx on action_intent(workspace_id);

create table approval_request (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  action_intent_id uuid not null references action_intent(id) on delete cascade,
  requested_by_principal_id text not null,
  requested_by_principal_type principal_type not null,
  required_approver_scope text not null,
  human_summary text not null,
  consequence_summary text not null,
  reversibility text not null,
  target_fingerprint text not null,
  parameters_digest text not null,
  state approval_state not null default 'PENDING',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  resolved_by_principal_id text,
  decision text
);
create index approval_workspace_state_idx on approval_request(workspace_id, state);

create table audit_event (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  occurred_at timestamptz not null default now(),
  actor_principal_id text not null,
  actor_type principal_type not null,
  action text not null,
  target_type text,
  target_id text,
  action_intent_id uuid,
  approval_id uuid,
  request_id text not null,
  source text not null,
  outcome text not null,
  metadata_sanitized_json jsonb not null default '{}'::jsonb
);
create index audit_workspace_time_idx on audit_event(workspace_id, occurred_at);

create table agent_credential_binding (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspace_profile(workspace_id) on delete cascade,
  agent_id uuid not null references agent_profile(id) on delete cascade,
  api_key_id text not null unique,
  enabled boolean not null default true,
  capabilities_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
create index agent_credential_workspace_agent_idx
  on agent_credential_binding(workspace_id, agent_id);
