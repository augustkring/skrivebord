import type { PrincipalContext, ToolResult, WorkItem } from "@skrivebord/contracts";
import {
  buildTodayView,
  type Booking,
  type OperationalSnapshot,
  type YearPlanItem
} from "@skrivebord/domain";
import { CAPABILITIES, hasCapabilities, type Capability } from "@skrivebord/policy";

const capabilitySet = new Set<string>(CAPABILITIES);

export function normalizeAgentCapabilities(value: unknown): Capability[] {
  let source = value;

  if (typeof source === "string") {
    try {
      source = JSON.parse(source) as unknown;
    } catch {
      return [];
    }
  }

  if (typeof source !== "object" || source === null) return [];

  const raw = (source as Record<string, unknown>).skrivebord;
  if (!Array.isArray(raw)) return [];

  return raw.filter(
    (item): item is Capability =>
      typeof item === "string" && capabilitySet.has(item)
  );
}

function assertWorkspace(
  principal: PrincipalContext,
  snapshot: OperationalSnapshot
): ToolResult<never> | null {
  if (principal.workspaceId !== snapshot.workspaceId) {
    return {
      status: "DENIED",
      humanSummary: "Workspace scope matcher ikke agentens credential."
    };
  }
  return null;
}

function requireCapability(
  principal: PrincipalContext,
  capability: string
): ToolResult<never> | null {
  if (!hasCapabilities(principal, [capability])) {
    return {
      status: "DENIED",
      humanSummary: "Agenten har ikke den nødvendige capability."
    };
  }
  return null;
}

export function getTodayForAgent(
  principal: PrincipalContext,
  snapshot: OperationalSnapshot,
  now: Date
): ToolResult<{
  requiresYou: WorkItem[];
  today: WorkItem[];
  upcoming: WorkItem[];
  thisMonth: WorkItem[];
}> {
  const workspaceError = assertWorkspace(principal, snapshot);
  if (workspaceError) return workspaceError;

  const permissionError = requireCapability(principal, "today.read");
  if (permissionError) return permissionError;

  const view = buildTodayView(snapshot, now);
  return {
    status: "SUCCEEDED",
    humanSummary: "Dagens operationelle overblik blev hentet.",
    data: view
  };
}

export function listBookingsForAgent(
  principal: PrincipalContext,
  snapshot: OperationalSnapshot
): ToolResult<Booking[]> {
  const workspaceError = assertWorkspace(principal, snapshot);
  if (workspaceError) return workspaceError;

  const permissionError = requireCapability(principal, "booking.read");
  if (permissionError) return permissionError;

  return {
    status: "SUCCEEDED",
    humanSummary: `${snapshot.bookings.length} bookinger fundet.`,
    data: snapshot.bookings
  };
}

export function getBookingForAgent(
  principal: PrincipalContext,
  snapshot: OperationalSnapshot,
  bookingId: string
): ToolResult<Booking> {
  const workspaceError = assertWorkspace(principal, snapshot);
  if (workspaceError) return workspaceError;

  const permissionError = requireCapability(principal, "booking.read");
  if (permissionError) return permissionError;

  const booking = snapshot.bookings.find((item) => item.id === bookingId);
  if (!booking) {
    return {
      status: "FAILED",
      humanSummary: "Bookingen blev ikke fundet."
    };
  }

  return {
    status: "SUCCEEDED",
    humanSummary: `Booking ${booking.id} blev hentet.`,
    data: booking
  };
}

export function listYearPlanForAgent(
  principal: PrincipalContext,
  snapshot: OperationalSnapshot
): ToolResult<YearPlanItem[]> {
  const workspaceError = assertWorkspace(principal, snapshot);
  if (workspaceError) return workspaceError;

  const permissionError = requireCapability(principal, "yearplan.read");
  if (permissionError) return permissionError;

  return {
    status: "SUCCEEDED",
    humanSummary: `${snapshot.yearPlanItems.length} årshjulsaktiviteter fundet.`,
    data: snapshot.yearPlanItems
  };
}


export * from "./openclaw";
