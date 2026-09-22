import {
  getBookingForAgent,
  getTodayForAgent,
  listBookingsForAgent,
  listYearPlanForAgent
} from "@skrivebord/agent";
import type { PrincipalContext } from "@skrivebord/contracts";
import { buildAlsLebenSnapshot } from "@skrivebord/domain";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { resolveMcpAgentPrincipal } from "@/lib/mcp-auth";

export const dynamic = "force-dynamic";

const workItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  reason: z.string(),
  priorityClass: z.enum(["REQUIRES_YOU", "TODAY", "UPCOMING"]),
  timingLabel: z.string().optional(),
  recommendedActionId: z.string(),
  recommendedActionLabel: z.string()
});

const bookingSchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  guestDisplayName: z.string(),
  checkInAt: z.string(),
  checkOutAt: z.string(),
  status: z.enum(["ACTIVE", "CANCELLED", "COMPLETED"])
});

const yearPlanSchema = z.object({
  id: z.string(),
  propertyId: z.string().optional(),
  title: z.string(),
  description: z.string(),
  month: z.number(),
  windowStartDay: z.number(),
  windowEndDay: z.number(),
  windowLabel: z.string(),
  active: z.boolean()
});

function has(principal: PrincipalContext, capability: string) {
  return principal.capabilities.includes(capability);
}

function buildHandler(principal: PrincipalContext) {
  const snapshot = buildAlsLebenSnapshot(principal.workspaceId);

  return createMcpHandler(
    (server) => {
      if (has(principal, "today.read")) {
        server.registerTool(
          "workspace.get_today",
          {
            title: "Hent dagens overblik",
            description:
              "Henter det deterministiske operationelle Today-overblik for agentens eget workspace.",
            inputSchema: z.object({}),
            outputSchema: z.object({
              humanSummary: z.string(),
              requiresYou: z.array(workItemSchema),
              today: z.array(workItemSchema),
              upcoming: z.array(workItemSchema),
              thisMonth: z.array(workItemSchema)
            }),
            annotations: {
              readOnlyHint: true
            }
          },
          async () => {
            const result = getTodayForAgent(principal, snapshot, new Date());
            if (result.status !== "SUCCEEDED" || !result.data) {
              return {
                isError: true,
                content: [{ type: "text", text: result.humanSummary }]
              };
            }

            const output = {
              humanSummary: result.humanSummary,
              requiresYou: result.data.requiresYou,
              today: result.data.today,
              upcoming: result.data.upcoming,
              thisMonth: result.data.thisMonth
            };

            return {
              content: [{ type: "text", text: result.humanSummary }],
              structuredContent: output
            };
          }
        );
      }

      if (has(principal, "booking.read")) {
        server.registerTool(
          "bookings.list",
          {
            title: "List bookinger",
            description:
              "Lister bookinger i agentens eget workspace. Returnerer ikke connector-tokens eller andre secrets.",
            inputSchema: z.object({}),
            outputSchema: z.object({
              humanSummary: z.string(),
              bookings: z.array(bookingSchema)
            }),
            annotations: {
              readOnlyHint: true
            }
          },
          async () => {
            const result = listBookingsForAgent(principal, snapshot);
            if (result.status !== "SUCCEEDED" || !result.data) {
              return {
                isError: true,
                content: [{ type: "text", text: result.humanSummary }]
              };
            }

            const output = {
              humanSummary: result.humanSummary,
              bookings: result.data
            };

            return {
              content: [{ type: "text", text: result.humanSummary }],
              structuredContent: output
            };
          }
        );

        server.registerTool(
          "bookings.get",
          {
            title: "Hent booking",
            description:
              "Henter én booking fra agentens eget workspace ud fra Skrivebord booking-ID.",
            inputSchema: z.object({
              bookingId: z.string().min(1)
            }),
            outputSchema: z.object({
              humanSummary: z.string(),
              booking: bookingSchema
            }),
            annotations: {
              readOnlyHint: true
            }
          },
          async ({ bookingId }) => {
            const result = getBookingForAgent(principal, snapshot, bookingId);
            if (result.status !== "SUCCEEDED" || !result.data) {
              return {
                isError: true,
                content: [{ type: "text", text: result.humanSummary }]
              };
            }

            const output = {
              humanSummary: result.humanSummary,
              booking: result.data
            };

            return {
              content: [{ type: "text", text: result.humanSummary }],
              structuredContent: output
            };
          }
        );
      }

      if (has(principal, "yearplan.read")) {
        server.registerTool(
          "year_plan.list",
          {
            title: "List årsplan",
            description:
              "Lister aktive og planlagte årshjulsaktiviteter i agentens eget workspace.",
            inputSchema: z.object({}),
            outputSchema: z.object({
              humanSummary: z.string(),
              items: z.array(yearPlanSchema)
            }),
            annotations: {
              readOnlyHint: true
            }
          },
          async () => {
            const result = listYearPlanForAgent(principal, snapshot);
            if (result.status !== "SUCCEEDED" || !result.data) {
              return {
                isError: true,
                content: [{ type: "text", text: result.humanSummary }]
              };
            }

            const output = {
              humanSummary: result.humanSummary,
              items: result.data
            };

            return {
              content: [{ type: "text", text: result.humanSummary }],
              structuredContent: output
            };
          }
        );
      }
    },
    {
      serverInfo: {
        name: "skrivebord",
        version: "0.1.0"
      },
      instructions:
        "Operate only within the authenticated workspace. Use read tools to inspect state. Do not claim an external action happened unless a mutation tool returns a committed result."
    }
  );
}

async function handle(request: Request) {
  const principal = await resolveMcpAgentPrincipal(request);

  if (!principal) {
    return Response.json(
      {
        error: "UNAUTHORIZED",
        message: "A valid Skrivebord agent credential is required."
      },
      { status: 401 }
    );
  }

  return buildHandler(principal)(request);
}

export { handle as GET, handle as POST };
