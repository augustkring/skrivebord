import { executeAction } from "@skrivebord/actions";
import type { PrincipalContext } from "@skrivebord/contracts";
import {
  createCompleteWorkItemAction,
  getActionStatus,
  getCalendarEvent,
  listCalendarEvents,
  listTodayItems,
  listYearPlanItems,
  loadOperationalSnapshot,
  PostgresActionStore,
  recomputeToday,
  searchCalendarEvents,
  TransactionalPostgresActionStore,
  withPrincipalTransaction
} from "@skrivebord/database";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { databasePool } from "@/lib/database";
import {
  createMoveGoogleCalendarEventAction
} from "@/lib/google-calendar-actions";
import { resolveMcpAgentPrincipal } from "@/lib/mcp-auth";

export const dynamic = "force-dynamic";

const workItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  reason: z.string(),
  priorityClass: z.enum([
    "REQUIRES_YOU",
    "TODAY",
    "UPCOMING"
  ]),
  suggestedActionId: z.string().nullable(),
  suggestedActionLabel: z.string().nullable()
});

const bookingSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  guestDisplayName: z.string(),
  checkInAt: z.string(),
  checkOutAt: z.string(),
  status: z.enum([
    "ACTIVE",
    "CANCELLED",
    "COMPLETED"
  ])
});

const yearPlanSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid().optional(),
  title: z.string(),
  description: z.string(),
  month: z.number().int().min(1).max(12),
  windowStartDay: z.number().int().min(1).max(31),
  windowEndDay: z.number().int().min(1).max(31),
  windowLabel: z.string(),
  active: z.boolean()
});

const calendarEventSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  category: z.string(),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  allDay: z.boolean(),
  timezone: z.string().nullable(),
  status: z.string(),
  provider: z.string(),
  sourceName: z.string(),
  syncState: z.string()
});

function has(
  principal: PrincipalContext,
  capability: string
): boolean {
  return principal.capabilities.includes(capability);
}

function actionLabel(
  actionId: string | null
): string | null {
  if (!actionId) return null;

  const labels: Record<string, string> = {
    "booking.resolve_conflict": "Gennemgå konflikt",
    "connection.reconnect": "Forbind igen",
    "guest_message.draft": "Klargør besked",
    "yearplan.complete": "Åbn aktivitet",
    "today.complete": "Markér færdig"
  };

  return labels[actionId] ?? actionId;
}

function mapTodayItem(
  item: Awaited<
    ReturnType<typeof listTodayItems>
  >[number]
) {
  return {
    id: item.id,
    title: item.title,
    reason: item.reason,
    priorityClass: item.priorityClass as
      | "REQUIRES_YOU"
      | "TODAY"
      | "UPCOMING",
    suggestedActionId: item.suggestedActionId,
    suggestedActionLabel: actionLabel(
      item.suggestedActionId
    )
  };
}

function mapCalendarEvent(
  event: Awaited<
    ReturnType<
      typeof listCalendarEvents
    >
  >[number]
) {
  return {
    id: event.id,
    title: event.title,
    category: event.category,
    startAt:
      event.startAt
        ?.toISOString() ??
      null,
    endAt:
      event.endAt
        ?.toISOString() ??
      null,
    startDate:
      event.startDate ?? null,
    endDate:
      event.endDate ?? null,
    allDay: event.allDay,
    timezone:
      event.timezone ?? null,
    status: event.status,
    provider: event.provider,
    sourceName:
      event.sourceName,
    syncState:
      event.syncState
  };
}

function buildHandler(principal: PrincipalContext) {
  return createMcpHandler(
    (server) => {
      if (has(principal, "today.read")) {
        server.registerTool(
          "workspace.get_today",
          {
            title: "Hent dagens overblik",
            description:
              "Henter den persistede, deterministiske Today-model for agentens eget workspace.",
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
            const rows =
              await withPrincipalTransaction(
                databasePool,
                principal,
                async ({ db }) => {
                  await recomputeToday(
                    db,
                    principal.workspaceId,
                    new Date()
                  );

                  return listTodayItems(
                    db,
                    principal.workspaceId
                  );
                }
              );

            const active = rows.filter(
              (item) =>
                item.status !== "DONE" &&
                item.status !== "DISMISSED"
            );

            const output = {
              humanSummary:
                "Dagens operationelle overblik blev hentet.",
              requiresYou: active
                .filter(
                  (item) =>
                    item.priorityClass ===
                    "REQUIRES_YOU"
                )
                .map(mapTodayItem),
              today: active
                .filter(
                  (item) =>
                    item.priorityClass === "TODAY"
                )
                .map(mapTodayItem),
              upcoming: active
                .filter(
                  (item) =>
                    item.priorityClass ===
                    "UPCOMING"
                )
                .map(mapTodayItem),
              thisMonth: active
                .filter(
                  (item) =>
                    item.kind === "YEAR_PLAN"
                )
                .map(mapTodayItem)
            };

            return {
              content: [
                {
                  type: "text",
                  text: output.humanSummary
                }
              ],
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
              "Lister bookinger i agentens eget workspace. Returnerer aldrig connector credentials.",
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
            const snapshot =
              await withPrincipalTransaction(
                databasePool,
                principal,
                ({ db }) =>
                  loadOperationalSnapshot(
                    db,
                    principal.workspaceId
                  )
              );

            const output = {
              humanSummary:
                `${snapshot.bookings.length} bookinger fundet.`,
              bookings: snapshot.bookings
            };

            return {
              content: [
                {
                  type: "text",
                  text: output.humanSummary
                }
              ],
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
              bookingId: z.string().uuid()
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
            const snapshot =
              await withPrincipalTransaction(
                databasePool,
                principal,
                ({ db }) =>
                  loadOperationalSnapshot(
                    db,
                    principal.workspaceId
                  )
              );

            const booking =
              snapshot.bookings.find(
                (item) => item.id === bookingId
              );

            if (!booking) {
              return {
                isError: true,
                content: [
                  {
                    type: "text",
                    text: "Bookingen blev ikke fundet."
                  }
                ]
              };
            }

            const output = {
              humanSummary:
                `Booking ${booking.id} blev hentet.`,
              booking
            };

            return {
              content: [
                {
                  type: "text",
                  text: output.humanSummary
                }
              ],
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
              "Lister aktive årshjulsaktiviteter i agentens eget workspace.",
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
            const rows =
              await withPrincipalTransaction(
                databasePool,
                principal,
                ({ db }) =>
                  listYearPlanItems(
                    db,
                    principal.workspaceId
                  )
              );

            const items = rows.map((item) => ({
              id: item.id,
              propertyId:
                item.propertyId ?? undefined,
              title: item.title,
              description: item.description,
              month: item.month,
              windowStartDay:
                item.windowStartDay,
              windowEndDay:
                item.windowEndDay,
              windowLabel:
                `${item.windowStartDay}.–${item.windowEndDay}. måned ${item.month}`,
              active: item.active
            }));

            const output = {
              humanSummary:
                `${items.length} årshjulsaktiviteter fundet.`,
              items
            };

            return {
              content: [
                {
                  type: "text",
                  text: output.humanSummary
                }
              ],
              structuredContent: output
            };
          }
        );
      }

      if (has(principal, "calendar.read")) {
        server.registerTool(
          "calendar.search_events",
          {
            title: "Søg kalenderbegivenheder",
            description:
              "Søger normaliserede kalenderbegivenheder i agentens eget workspace efter titel.",
            inputSchema: z.object({
              query:
                z.string()
                  .trim()
                  .min(1)
                  .max(200),
              limit:
                z.number()
                  .int()
                  .min(1)
                  .max(100)
                  .optional()
            }),
            outputSchema: z.object({
              humanSummary:
                z.string(),
              events:
                z.array(
                  calendarEventSchema
                )
            }),
            annotations: {
              readOnlyHint: true
            }
          },
          async ({
            query,
            limit
          }) => {
            const rows =
              await withPrincipalTransaction(
                databasePool,
                principal,
                ({ db }) =>
                  searchCalendarEvents(
                    db,
                    {
                      workspaceId:
                        principal.workspaceId,
                      query,
                      limit
                    }
                  )
              );

            const events =
              rows.map(
                mapCalendarEvent
              );

            const output = {
              humanSummary:
                `${events.length} kalenderbegivenheder matchede søgningen.`,
              events
            };

            return {
              content: [
                {
                  type: "text",
                  text:
                    output.humanSummary
                }
              ],
              structuredContent:
                output
            };
          }
        );

        server.registerTool(
          "calendar.get_event",
          {
            title: "Hent kalenderbegivenhed",
            description:
              "Henter én normaliseret kalenderbegivenhed i agentens eget workspace ud fra Skrivebord event-ID.",
            inputSchema: z.object({
              eventId:
                z.string().uuid()
            }),
            outputSchema: z.object({
              humanSummary:
                z.string(),
              event:
                calendarEventSchema
            }),
            annotations: {
              readOnlyHint: true
            }
          },
          async ({ eventId }) => {
            const event =
              await withPrincipalTransaction(
                databasePool,
                principal,
                ({ db }) =>
                  getCalendarEvent(
                    db,
                    {
                      workspaceId:
                        principal.workspaceId,
                      eventId
                    }
                  )
              );

            if (!event) {
              return {
                isError: true,
                content: [
                  {
                    type: "text",
                    text:
                      "Kalenderbegivenheden blev ikke fundet."
                  }
                ]
              };
            }

            const output = {
              humanSummary:
                `${event.title} blev hentet.`,
              event:
                mapCalendarEvent(
                  event
                )
            };

            return {
              content: [
                {
                  type: "text",
                  text:
                    output.humanSummary
                }
              ],
              structuredContent:
                output
            };
          }
        );

        server.registerTool(
          "calendar.list",
          {
            title: "List kalender",
            description:
              "Lister normaliserede kalenderbegivenheder fra agentens eget workspace.",
            inputSchema: z.object({}),
            outputSchema: z.object({
              humanSummary: z.string(),
              events: z.array(calendarEventSchema)
            }),
            annotations: {
              readOnlyHint: true
            }
          },
          async () => {
            const rows =
              await withPrincipalTransaction(
                databasePool,
                principal,
                ({ db }) =>
                  listCalendarEvents(
                    db,
                    principal.workspaceId
                  )
              );

            const events =
              rows.map(
                mapCalendarEvent
              );

            const output = {
              humanSummary:
                `${events.length} kalenderbegivenheder fundet.`,
              events
            };

            return {
              content: [
                {
                  type: "text",
                  text: output.humanSummary
                }
              ],
              structuredContent: output
            };
          }
        );
      }


      if (has(principal, "calendar.update")) {
        server.registerTool(
          "calendar.move_event",
          {
            title: "Flyt kalenderbegivenhed",
            description:
              "Anmoder om at flytte en eksisterende kalenderbegivenhed. Enkelt forekomst og hele serien er eksplicitte scopes. Mojn kan ikke selv godkende handlingen.",
            inputSchema: z.object({
              eventId: z.string().uuid(),
              startsAt: z.string().datetime({
                offset: true
              }),
              endsAt: z.string().datetime({
                offset: true
              }),
              scope: z.enum([
                "OCCURRENCE",
                "SERIES"
              ]),
              idempotencyKey:
                z.string().uuid()
            }),
            outputSchema: z.object({
              status: z.enum([
                "PENDING_APPROVAL",
                "SUCCEEDED",
                "FAILED",
                "DENIED",
                "CONFLICT"
              ]),
              humanSummary: z.string(),
              actionId:
                z.string().uuid().optional(),
              approvalId:
                z.string().uuid().optional(),
              executionId:
                z.string().uuid().optional()
            }),
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true
            }
          },
          async ({
            eventId,
            startsAt,
            endsAt,
            scope,
            idempotencyKey
          }) => {
            const store =
              new TransactionalPostgresActionStore(
                databasePool,
                principal
              );

            const result =
              await executeAction({
                definition:
                  createMoveGoogleCalendarEventAction(),
                principal,
                rawInput: {
                  workspaceId:
                    principal.workspaceId,
                  eventId,
                  startsAt,
                  endsAt,
                  scope
                },
                idempotencyKey,
                store
              });

            const output = {
              status:
                result.status,
              humanSummary:
                result.humanSummary,
              actionId:
                result.actionId,
              approvalId:
                result.approvalId,
              executionId:
                result.executionId
            };

            return {
              content: [
                {
                  type: "text",
                  text:
                    result.status ===
                    "PENDING_APPROVAL"
                      ? `${result.humanSummary} Afventer menneskelig godkendelse.`
                      : result.humanSummary
                }
              ],
              structuredContent:
                output
            };
          }
        );
      }


      if (has(principal, "activity.read")) {
        server.registerTool(
          "actions.get_status",
          {
            title: "Hent handlingsstatus",
            description:
              "Henter status for en handling, som denne agent selv har anmodet om i det aktive workspace.",
            inputSchema: z.object({
              actionId:
                z.string().uuid()
            }),
            outputSchema: z.object({
              status: z.enum([
                "PENDING",
                "WAITING_APPROVAL",
                "QUEUED",
                "RUNNING",
                "SUCCEEDED",
                "PARTIAL",
                "FAILED",
                "CANCELLED",
                "ROLLED_BACK"
              ]),
              humanSummary:
                z.string(),
              actionId:
                z.string().uuid(),
              actionType:
                z.string(),
              approval: z.object({
                id:
                  z.string().uuid(),
                state:
                  z.string(),
                expiresAt:
                  z.string()
              }).optional(),
              execution: z.object({
                id:
                  z.string().uuid(),
                state:
                  z.string(),
                attemptCount:
                  z.number().int(),
                errorCode:
                  z.string().nullable(),
                retryable:
                  z.boolean(),
                externalEffectRefs:
                  z.array(z.string())
              }).optional()
            }),
            annotations: {
              readOnlyHint: true
            }
          },
          async ({ actionId }) => {
            const state =
              await withPrincipalTransaction(
                databasePool,
                principal,
                ({ db }) =>
                  getActionStatus(
                    db,
                    {
                      workspaceId:
                        principal.workspaceId,
                      actionIntentId:
                        actionId,
                      requestedByPrincipalId:
                        principal.principalId
                    }
                  )
              );

            if (!state) {
              return {
                isError: true,
                content: [
                  {
                    type: "text",
                    text:
                      "Handlingen blev ikke fundet."
                  }
                ]
              };
            }

            const externalEffectRefs =
              Array.isArray(
                state.execution
                  ?.externalEffectRefs
              )
                ? state.execution!
                    .externalEffectRefs
                    .filter(
                      (
                        value
                      ): value is string =>
                        typeof value ===
                        "string"
                    )
                : [];

            const humanSummary =
              state.state ===
              "WAITING_APPROVAL"
                ? `${state.humanSummary} Afventer menneskelig godkendelse.`
                : state.state ===
                    "SUCCEEDED"
                  ? `${state.humanSummary} Gennemført.`
                  : state.state ===
                      "FAILED"
                    ? `${state.humanSummary} Fejlede.`
                    : state.humanSummary;

            const output = {
              status:
                state.state,
              humanSummary,
              actionId:
                state.id,
              actionType:
                state.actionId,
              ...(state.approval
                ? {
                    approval: {
                      id:
                        state.approval.id,
                      state:
                        state.approval.state,
                      expiresAt:
                        state.approval
                          .expiresAt
                          .toISOString()
                    }
                  }
                : {}),
              ...(state.execution
                ? {
                    execution: {
                      id:
                        state.execution.id,
                      state:
                        state.execution.state,
                      attemptCount:
                        state.execution
                          .attemptCount,
                      errorCode:
                        state.execution
                          .errorCode ??
                        null,
                      retryable:
                        state.execution
                          .retryable,
                      externalEffectRefs
                    }
                  }
                : {})
            };

            return {
              content: [
                {
                  type: "text",
                  text:
                    output.humanSummary
                }
              ],
              structuredContent:
                output
            };
          }
        );
      }

      if (has(principal, "today.manage")) {
        server.registerTool(
          "today.complete",
          {
            title: "Markér Today-arbejde færdigt",
            description:
              "Markerer et eksisterende work item som færdigt gennem Skrivebords fælles Action Layer og audit.",
            inputSchema: z.object({
              workItemId: z.string().uuid()
            }),
            outputSchema: z.object({
              status: z.literal("SUCCEEDED"),
              humanSummary: z.string(),
              actionId: z.string().uuid(),
              workItemId: z.string().uuid(),
              completedAt: z.string()
            }),
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true
            }
          },
          async ({ workItemId }) => {
            const result =
              await withPrincipalTransaction(
                databasePool,
                principal,
                async ({ db }) => {
                  const store =
                    new PostgresActionStore(
                      db,
                      principal.workspaceId
                    );

                  return executeAction({
                    definition:
                      createCompleteWorkItemAction(
                        db
                      ),
                    principal,
                    rawInput: {
                      workspaceId:
                        principal.workspaceId,
                      workItemId
                    },
                    store
                  });
                }
              );

            if (
              result.status !== "SUCCEEDED" ||
              !result.data ||
              !result.actionId
            ) {
              return {
                isError: true,
                content: [
                  {
                    type: "text",
                    text: result.humanSummary
                  }
                ]
              };
            }

            const output = {
              status: "SUCCEEDED" as const,
              humanSummary:
                result.humanSummary,
              actionId: result.actionId,
              workItemId:
                result.data.workItemId,
              completedAt:
                result.data.completedAt
            };

            return {
              content: [
                {
                  type: "text",
                  text: output.humanSummary
                }
              ],
              structuredContent: output
            };
          }
        );
      }
    },
    {
      serverInfo: {
        name: "skrivebord",
        version: "0.2.0"
      },
      instructions:
        "Operate only within the authenticated workspace. Read business state through typed tools. Mutations always pass through Skrivebord's Action Layer. Never claim an action happened unless the tool returns a committed result."
    }
  );
}

async function handle(request: Request) {
  const principal =
    await resolveMcpAgentPrincipal(request);

  if (!principal) {
    return Response.json(
      {
        error: "UNAUTHORIZED",
        message:
          "A valid Skrivebord agent credential is required."
      },
      { status: 401 }
    );
  }

  return buildHandler(principal)(request);
}

export { handle as GET, handle as POST };
