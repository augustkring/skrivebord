import { z } from "zod";

export type PrincipalType = "HUMAN" | "AGENT" | "SYSTEM";
export type AuthStrength = "SESSION" | "STEP_UP";
export type PrincipalSource = "WEB" | "MCP" | "WORKFLOW" | "WEBHOOK" | "SYSTEM";

export type PrincipalContext = {
  principalId: string;
  principalType: PrincipalType;
  workspaceId: string;
  roles: string[];
  capabilities: string[];
  authStrength: AuthStrength;
  source: PrincipalSource;
  requestId: string;
};

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type PolicyDecision = | { type: "AUTO" } | { type: "REVIEW_REQUIRED"; reason: string } | { type: "DENY"; reason: string };
export type WorkEvidence = { kind: "BOOKING" | "CALENDAR_EVENT" | "YEAR_PLAN" | "RULE" | "CONNECTOR_STATE" | "AGENT_ANALYSIS"; id?: string; label: string; timestamp?: string };
export type WorkItem = { id: string; workspaceId: string; kind: string; title: string; reason: string; priorityClass: "REQUIRES_YOU" | "TODAY" | "UPCOMING"; dueAt?: string; timingLabel?: string; evidence: WorkEvidence[]; recommendedActionId: string; recommendedActionLabel: string; agentExecutionMode: "AUTO" | "REVIEW" | "HUMAN_ONLY"; attentionType?: "APPROVAL" | "CONFLICT" | "QUESTION" | "ERROR" | "ACCESS" | "SECURITY" };

export const CompleteWorkItemInputSchema = z.object({ workItemId: z.string().min(1), workspaceId: z.string().min(1) }).strict();
export type CompleteWorkItemInput = z.infer<typeof CompleteWorkItemInputSchema>;
export const MoveCalendarEventInputSchema = z.object({ eventId: z.string().min(1), workspaceId: z.string().min(1), startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), scope: z.enum(["OCCURRENCE", "SERIES"]) }).strict();
export type MoveCalendarEventInput = z.infer<typeof MoveCalendarEventInputSchema>;
export type ToolResult<T> = { status: "SUCCEEDED" | "PENDING_APPROVAL" | "DENIED" | "FAILED" | "CONFLICT"; humanSummary: string; actionId?: string; approvalId?: string; evidence?: WorkEvidence[]; data?: T; recovery?: { label: string; action: string } };
