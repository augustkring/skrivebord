import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const principalType = pgEnum("principal_type", ["HUMAN", "AGENT", "SYSTEM"]);
export const approvalState = pgEnum("approval_state", ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "REVOKED", "CONSUMED", "SUPERSEDED"]);
export const actionState = pgEnum("action_state", ["PENDING", "WAITING_APPROVAL", "QUEUED", "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED", "ROLLED_BACK"]);

export const workspaceProfile = pgTable("workspace_profile", {
  workspaceId: text("workspace_id").primaryKey(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  locale: text("locale").notNull().default("da-DK"),
  timezone: text("timezone").notNull().default("Europe/Copenhagen"),
  weekStartsOn: integer("week_starts_on").notNull().default(1),
  brandConfig: jsonb("brand_config_json").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const agentProfile = pgTable("agent_profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  runtimeType: text("runtime_type").notNull().default("OPENCLAW"),
  runtimeAgentKey: text("runtime_agent_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  status: text("status").notNull().default("UNKNOWN"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [index("agent_workspace_idx").on(t.workspaceId)]);


export const property = pgTable("property", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  address: jsonb("address_json").notNull().default({}),
  timezone: text("timezone").notNull().default("Europe/Copenhagen"),
  active: boolean("active").notNull().default(true),
  externalRefs: jsonb("external_refs_json").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  index("property_workspace_idx").on(t.workspaceId)
]);

export const booking = pgTable("booking", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  propertyId: uuid("property_id").notNull(),
  externalSource: text("external_source").notNull(),
  externalId: text("external_id").notNull(),
  guestDisplayName: text("guest_display_name").notNull(),
  checkInAt: timestamp("check_in_at", { withTimezone: true }).notNull(),
  checkOutAt: timestamp("check_out_at", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  normalizedAt: timestamp("normalized_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex("booking_external_unique").on(t.workspaceId, t.externalSource, t.externalId),
  index("booking_workspace_idx").on(t.workspaceId)
]);


export const yearPlanItem = pgTable("year_plan_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  moduleId: text("module_id").notNull().default("rental"),
  propertyId: uuid("property_id"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  month: integer("month").notNull(),
  windowStartDay: integer("window_start_day").notNull(),
  windowEndDay: integer("window_end_day").notNull(),
  recurrenceRule: text("recurrence_rule"),
  actionTemplateId: text("action_template_id"),
  defaultOwnerType: text("default_owner_type"),
  defaultOwnerId: text("default_owner_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  index("year_plan_workspace_month_idx").on(t.workspaceId, t.month)
]);

export const workItem = pgTable("work_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  moduleId: text("module_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull(),
  priorityClass: text("priority_class").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  evidence: jsonb("evidence_json").notNull().default([]),
  suggestedActionId: text("suggested_action_id"),
  agentExecutionMode: text("agent_execution_mode").notNull(),
  dedupeFingerprint: text("dedupe_fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true })
}, (t) => [uniqueIndex("work_item_dedupe_unique").on(t.workspaceId, t.dedupeFingerprint)]);


export const connectorAccount = pgTable("connector_account", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  provider: text("provider").notNull(),
  displayName: text("display_name").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  status: text("status").notNull().default("CONNECTED"),
  scopes: jsonb("scopes_json").notNull().default([]),
  connectedBy: text("connected_by").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex("connector_account_provider_unique").on(
    t.workspaceId,
    t.provider,
    t.providerAccountId
  ),
  index("connector_account_workspace_idx").on(t.workspaceId)
]);


export const connectorCredential = pgTable("connector_credential", {
  connectorAccountId: uuid("connector_account_id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  encryptedPayload: text("encrypted_payload").notNull(),
  keyId: text("key_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const calendarSource = pgTable("calendar_source", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  provider: text("provider").notNull(),
  connectorAccountId: uuid("connector_account_id"),
  providerCalendarId: text("provider_calendar_id").notNull(),
  displayName: text("display_name").notNull(),
  writable: boolean("writable").notNull().default(false),
  syncState: text("sync_state").notNull().default("CONNECTED"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex("calendar_source_provider_unique").on(
    t.workspaceId,
    t.provider,
    t.providerCalendarId
  ),
  index("calendar_source_workspace_idx").on(t.workspaceId)
]);

export const calendarEvent = pgTable("calendar_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  calendarSourceId: uuid("calendar_source_id").notNull(),
  providerEventId: text("provider_event_id").notNull(),
  providerVersion: text("provider_version"),
  title: text("title").notNull(),
  descriptionSanitized: text("description_sanitized"),
  startAt: timestamp("start_at", { withTimezone: true }),
  endAt: timestamp("end_at", { withTimezone: true }),
  startDate: date("start_date"),
  endDate: date("end_date"),
  allDay: boolean("all_day").notNull().default(false),
  timezone: text("timezone"),
  recurrenceMasterId: text("recurrence_master_id"),
  recurrenceRule: text("recurrence_rule"),
  status: text("status").notNull().default("CONFIRMED"),
  category: text("category").notNull(),
  propertyId: uuid("property_id"),
  bookingId: uuid("booking_id"),
  originActorType: principalType("origin_actor_type").notNull().default("SYSTEM"),
  originActorId: text("origin_actor_id"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  normalizedAt: timestamp("normalized_at", { withTimezone: true }).notNull().defaultNow(),
  localVersion: integer("local_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex("calendar_event_provider_unique").on(
    t.workspaceId,
    t.calendarSourceId,
    t.providerEventId
  ),
  index("calendar_event_workspace_time_idx").on(t.workspaceId, t.startAt),
  index("calendar_event_workspace_date_idx").on(t.workspaceId, t.startDate)
]);

export const syncCursor = pgTable("sync_cursor", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  connectorAccountId: uuid("connector_account_id").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceScope: text("resource_scope").notNull(),
  cursorType: text("cursor_type").notNull(),
  cursorValueProtected: text("cursor_value_protected").notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex("sync_cursor_resource_unique").on(
    t.workspaceId,
    t.connectorAccountId,
    t.resourceType,
    t.resourceScope
  )
]);

export const syncRun = pgTable("sync_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  connectorAccountId: uuid("connector_account_id").notNull(),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  itemsSeen: integer("items_seen").notNull().default(0),
  itemsCreated: integer("items_created").notNull().default(0),
  itemsUpdated: integer("items_updated").notNull().default(0),
  itemsDeleted: integer("items_deleted").notNull().default(0),
  failureCode: text("failure_code")
}, (t) => [
  index("sync_run_workspace_started_idx").on(t.workspaceId, t.startedAt)
]);

export const actionIntent = pgTable("action_intent", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  actionId: text("action_id").notNull(),
  requestedByPrincipalId: text("requested_by_principal_id").notNull(),
  requestedByPrincipalType: principalType("requested_by_principal_type").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  parameters: jsonb("parameters_json").notNull(),
  parametersDigest: text("parameters_digest").notNull(),
  humanSummary: text("human_summary").notNull(),
  riskLevel: text("risk_level").notNull(),
  policyDecision: text("policy_decision").notNull(),
  state: actionState("state").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true })
}, (t) => [index("action_intent_workspace_idx").on(t.workspaceId)]);

export const approvalRequest = pgTable("approval_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  actionIntentId: uuid("action_intent_id").notNull(),
  requestedByPrincipalId: text("requested_by_principal_id").notNull(),
  requestedByPrincipalType: principalType("requested_by_principal_type").notNull(),
  requiredApproverScope: text("required_approver_scope").notNull(),
  humanSummary: text("human_summary").notNull(),
  consequenceSummary: text("consequence_summary").notNull(),
  reversibility: text("reversibility").notNull(),
  targetFingerprint: text("target_fingerprint").notNull(),
  parametersDigest: text("parameters_digest").notNull(),
  state: approvalState("state").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByPrincipalId: text("resolved_by_principal_id"),
  decision: text("decision")
}, (t) => [index("approval_workspace_state_idx").on(t.workspaceId, t.state)]);

export const auditEvent = pgTable("audit_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  actorPrincipalId: text("actor_principal_id").notNull(),
  actorType: principalType("actor_type").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  actionIntentId: uuid("action_intent_id"),
  approvalId: uuid("approval_id"),
  requestId: text("request_id").notNull(),
  source: text("source").notNull(),
  outcome: text("outcome").notNull(),
  metadata: jsonb("metadata_sanitized_json").notNull().default({})
}, (t) => [index("audit_workspace_time_idx").on(t.workspaceId, t.occurredAt)]);


export const agentCredentialBinding = pgTable("agent_credential_binding", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  apiKeyId: text("api_key_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  capabilities: jsonb("capabilities_json").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true })
}, (t) => [
  uniqueIndex("agent_credential_api_key_unique").on(t.apiKeyId),
  index("agent_credential_workspace_agent_idx").on(t.workspaceId, t.agentId)
]);
