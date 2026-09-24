import type {
  ActionDefinition
} from "@skrivebord/actions";
import {
  ConnectorError,
  GoogleCalendarConnector,
  MicrosoftCalendarConnector,
  type CalendarConnector,
  type CalendarSyncEvent
} from "@skrivebord/connectors";
import {
  MoveCalendarEventInputSchema,
  type MoveCalendarEventInput
} from "@skrivebord/contracts";
import {
  getCalendarCreateTarget,
  getCalendarMoveTarget,
  persistCalendarWriteResult,
  withPrincipalTransaction,
  type CalendarMoveTarget
} from "@skrivebord/database";
import {
  buildCalendarMovePatch,
  CalendarMoveError
} from "./calendar-move";
import { databasePool } from "./database";
import {
  getGoogleAccessContext
} from "./google-access";
import {
  getMicrosoftAccessContext
} from "./microsoft-access";
import { z } from "zod";

export type MoveCalendarEventResult = {
  provider:
    | "GOOGLE"
    | "MICROSOFT";
  localTargetEventId: string;
  calendarSourceId: string;
  providerEventId: string;
  providerVersion?: string;
  externalEffectRef: string;
  providerResult:
    CalendarSyncEvent;
};

const InputSchema =
  MoveCalendarEventInputSchema.superRefine(
    (value, ctx) => {
      const startsAt =
        new Date(value.startsAt);
      const endsAt =
        new Date(value.endsAt);

      if (
        endsAt.getTime() <=
        startsAt.getTime()
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "Sluttid skal ligge efter starttid."
        });
      }
    }
  );

function providerLabel(
  provider: string
): string {
  if (provider === "GOOGLE") {
    return "Google Calendar";
  }

  if (
    provider === "MICROSOFT"
  ) {
    return "Microsoft Calendar";
  }

  return "kalenderudbyderen";
}

async function connectorForTarget(
  target: {
    provider: string;
    connectorAccountId: string;
  },
  workspaceId: string,
  requestId: string,
  now: Date
): Promise<{
  connector: CalendarConnector;
  accessToken: string;
}> {
  if (
    target.provider === "GOOGLE"
  ) {
    const access =
      await getGoogleAccessContext({
        workspaceId,
        connectorAccountId:
          target.connectorAccountId,
        jobId:
          `system:calendar-move:${requestId}`,
        now
      });

    return {
      connector:
        new GoogleCalendarConnector(),
      accessToken:
        access.tokens.accessToken
    };
  }

  if (
    target.provider ===
    "MICROSOFT"
  ) {
    const access =
      await getMicrosoftAccessContext({
        workspaceId,
        connectorAccountId:
          target.connectorAccountId,
        jobId:
          `system:calendar-move:${requestId}`,
        now
      });

    return {
      connector:
        new MicrosoftCalendarConnector(),
      accessToken:
        access.tokens.accessToken
    };
  }

  throw new CalendarMoveError(
    "CALENDAR_PROVIDER_UNSUPPORTED",
    "Denne kalenderprovider understøtter ikke flytning endnu."
  );
}

export function createMoveCalendarEventAction(): ActionDefinition<
  MoveCalendarEventInput,
  MoveCalendarEventResult
> {
  return {
    id: "calendar.move",
    input: InputSchema,
    requiredCapabilities: [
      "calendar.update"
    ],
    risk: () => "MEDIUM",
    reversible: true,
    idempotency: "REQUIRED",
    preview: async ({
      principal,
      input
    }) => {
      const target =
        await withPrincipalTransaction(
          databasePool,
          principal,
          ({ db }) =>
            getCalendarMoveTarget(
              db,
              {
                workspaceId:
                  principal.workspaceId,
                eventId:
                  input.eventId,
                scope:
                  input.scope
              }
            )
        );

      return target
        ? `Flyt ${target.title}`
        : "Flyt kalenderbegivenhed";
    },
    approval: {
      requiredApproverScope:
        "OWNER",
      consequenceSummary: ({
        input
      }) =>
        input.scope === "SERIES"
          ? "Flytter hele den tilbagevendende kalenderbegivenhed hos den eksterne kalenderudbyder."
          : "Flytter kalenderbegivenheden hos den eksterne kalenderudbyder.",
      reversibility:
        "PARTIALLY_REVERSIBLE"
    },
    execute: async ({
      principal,
      input,
      now
    }) => {
      const target =
        await withPrincipalTransaction(
          databasePool,
          principal,
          ({ db }) =>
            getCalendarMoveTarget(
              db,
              {
                workspaceId:
                  principal.workspaceId,
                eventId:
                  input.eventId,
                scope:
                  input.scope
              }
            )
        );

      const patch =
        buildCalendarMovePatch({
          target,
          command: input
        });

      if (!target) {
        throw new CalendarMoveError(
          "CALENDAR_EVENT_NOT_FOUND",
          "Kalenderbegivenheden blev ikke fundet."
        );
      }

      const {
        connector,
        accessToken
      } =
        await connectorForTarget(
          target,
          principal.workspaceId,
          principal.requestId,
          now
        );

      let providerResult:
        CalendarSyncEvent;

      try {
        providerResult =
          await connector.updateEvent({
            accessToken,
            calendarId:
              target.providerCalendarId,
            eventId:
              target.providerEventId,
            providerVersion:
              target.providerVersion,
            event: patch
          });
      } catch (error) {
        if (
          error instanceof
            ConnectorError &&
          error.code ===
            "CONFLICT"
        ) {
          try {
            const current =
              await connector.getEvent({
                accessToken,
                calendarId:
                  target
                    .providerCalendarId,
                eventId:
                  target
                    .providerEventId
              });

            await withPrincipalTransaction(
              databasePool,
              principal,
              ({ db }) =>
                persistCalendarWriteResult(
                  db,
                  {
                    workspaceId:
                      principal
                        .workspaceId,
                    localTargetEventId:
                      target
                        .localTargetEventId,
                    providerResult:
                      current,
                    now
                  }
                )
            );
          } catch {
            // Preserve the original provider conflict as authoritative.
          }

          throw new CalendarMoveError(
            "CALENDAR_PROVIDER_CONFLICT",
            `Begivenheden er ændret i ${providerLabel(target.provider)} siden sidste synkronisering. Skrivebord har forsøgt at hente den nyeste version; gennemgå begivenheden og prøv igen.`
          );
        }

        throw error;
      }

      return {
        provider:
          target.provider as
            | "GOOGLE"
            | "MICROSOFT",
        localTargetEventId:
          target.localTargetEventId,
        calendarSourceId:
          target.calendarSourceId,
        providerEventId:
          target.providerEventId,
        providerVersion:
          providerResult
            .providerVersion,
        externalEffectRef:
          `${target.provider.toLowerCase()}:calendar:${target.providerCalendarId}:event:${target.providerEventId}`,
        providerResult
      };
    },
    externalEffectRefs: (
      result
    ) => [
      result.externalEffectRef
    ],
    classifyFailure: (
      error
    ) => {
      if (
        error instanceof
        ConnectorError
      ) {
        return {
          code: error.code,
          summary:
            error.message,
          retryable:
            error.retryable
        };
      }

      if (
        error instanceof
        CalendarMoveError
      ) {
        return {
          code: error.code,
          summary:
            error.message,
          retryable:
            error.retryable
        };
      }

      return {
        code:
          "CALENDAR_MOVE_FAILED",
        summary:
          error instanceof Error
            ? error.message
            : undefined,
        retryable: false
      };
    }
  };
}


const CreateTimedSchema =
  MoveCalendarEventInputSchema
    .pick({
      workspaceId: true
    })
    .extend({
      calendarSourceId:
        z.string().uuid(),
      title:
        z.string()
          .trim()
          .min(1)
          .max(300),
      description:
        z.string()
          .max(20_000)
          .optional(),
      timing:
        z.object({
          kind:
            z.literal("TIMED"),
          startsAt:
            z.string().datetime({
              offset: true
            }),
          endsAt:
            z.string().datetime({
              offset: true
            }),
          timezone:
            z.string()
              .min(1)
              .max(100)
              .optional()
        }).strict()
    })
    .strict()
    .superRefine(
      (value, ctx) => {
        if (
          new Date(
            value.timing.endsAt
          ).getTime() <=
          new Date(
            value.timing.startsAt
          ).getTime()
        ) {
          ctx.addIssue({
            code: "custom",
            path: [
              "timing",
              "endsAt"
            ],
            message:
              "Sluttid skal ligge efter starttid."
          });
        }
      }
    );

const DateOnlySchema =
  /^\d{4}-\d{2}-\d{2}$/;

const CreateAllDaySchema =
  MoveCalendarEventInputSchema
    .pick({
      workspaceId: true
    })
    .extend({
      calendarSourceId:
        z.string().uuid(),
      title:
        z.string()
          .trim()
          .min(1)
          .max(300),
      description:
        z.string()
          .max(20_000)
          .optional(),
      timing:
        z.object({
          kind:
            z.literal("ALL_DAY"),
          startDate:
            z.string()
              .regex(
                DateOnlySchema
              ),
          endDate:
            z.string()
              .regex(
                DateOnlySchema
              )
        }).strict()
    })
    .strict()
    .superRefine(
      (value, ctx) => {
        if (
          value.timing.endDate <=
          value.timing.startDate
        ) {
          ctx.addIssue({
            code: "custom",
            path: [
              "timing",
              "endDate"
            ],
            message:
              "Slutdato skal ligge efter startdato."
          });
        }
      }
    );

export const CreateCalendarEventInputSchema =
  z.union([
    CreateTimedSchema,
    CreateAllDaySchema
  ]);

export type CreateCalendarEventCommand =
  z.infer<
    typeof CreateCalendarEventInputSchema
  >;

export type CreateCalendarEventResult = {
  provider:
    | "GOOGLE"
    | "MICROSOFT";
  calendarSourceId: string;
  providerEventId: string;
  providerVersion?: string;
  externalEffectRef: string;
  providerResult:
    CalendarSyncEvent;
};

function assertCreateTarget(
  target:
    | Awaited<
        ReturnType<
          typeof getCalendarCreateTarget
        >
      >
    | undefined
) {
  if (!target) {
    throw new CalendarMoveError(
      "CALENDAR_SOURCE_NOT_FOUND",
      "Kalenderen blev ikke fundet."
    );
  }

  if (
    ![
      "GOOGLE",
      "MICROSOFT"
    ].includes(
      target.provider
    )
  ) {
    throw new CalendarMoveError(
      "CALENDAR_PROVIDER_UNSUPPORTED",
      "Denne kalenderprovider understøtter ikke oprettelse endnu."
    );
  }

  if (
    !target.writable ||
    ![
      "CONNECTED",
      "HEALTHY"
    ].includes(
      target.syncState
    )
  ) {
    throw new CalendarMoveError(
      "CALENDAR_SOURCE_NOT_WRITABLE",
      "Kalenderen kan ikke ændres i sin nuværende tilstand."
    );
  }

  return target;
}

function createEventWrite(
  input:
    CreateCalendarEventCommand
) {
  if (
    input.timing.kind ===
    "ALL_DAY"
  ) {
    return {
      title:
        input.title,
      description:
        input.description,
      start: {
        date:
          input.timing
            .startDate
      },
      end: {
        date:
          input.timing
            .endDate
      }
    };
  }

  return {
    title:
      input.title,
    description:
      input.description,
    start: {
      dateTime:
        input.timing
          .startsAt,
      ...(input.timing.timezone
        ? {
            timeZone:
              input.timing
                .timezone
          }
        : {})
    },
    end: {
      dateTime:
        input.timing
          .endsAt,
      ...(input.timing.timezone
        ? {
            timeZone:
              input.timing
                .timezone
          }
        : {})
    }
  };
}

export function createCalendarEventAction(): ActionDefinition<
  CreateCalendarEventCommand,
  CreateCalendarEventResult
> {
  return {
    id:
      "calendar.create",
    input:
      CreateCalendarEventInputSchema,
    requiredCapabilities: [
      "calendar.create"
    ],
    risk: () =>
      "MEDIUM",
    reversible: true,
    idempotency:
      "REQUIRED",
    preview: async ({
      input
    }) =>
      `Opret ${input.title}`,
    approval: {
      requiredApproverScope:
        "OWNER",
      consequenceSummary: () =>
        "Opretter en ny begivenhed i en ekstern kalender.",
      reversibility:
        "REVERSIBLE"
    },
    execute: async ({
      principal,
      input,
      now
    }) => {
      const target =
        assertCreateTarget(
          await withPrincipalTransaction(
            databasePool,
            principal,
            ({ db }) =>
              getCalendarCreateTarget(
                db,
                {
                  workspaceId:
                    principal
                      .workspaceId,
                  calendarSourceId:
                    input
                      .calendarSourceId
                }
              )
          )
        );

      const {
        connector,
        accessToken
      } =
        await connectorForTarget(
          target,
          principal.workspaceId,
          principal.requestId,
          now
        );

      const providerResult =
        await connector.createEvent({
          accessToken,
          calendarId:
            target
              .providerCalendarId,
          event:
            createEventWrite(
              input
            )
        });

      return {
        provider:
          target.provider as
            | "GOOGLE"
            | "MICROSOFT",
        calendarSourceId:
          target.calendarSourceId,
        providerEventId:
          providerResult
            .providerEventId,
        providerVersion:
          providerResult
            .providerVersion,
        externalEffectRef:
          `${target.provider.toLowerCase()}:calendar:${target.providerCalendarId}:event:${providerResult.providerEventId}`,
        providerResult
      };
    },
    externalEffectRefs: (
      result
    ) => [
      result.externalEffectRef
    ],
    classifyFailure: (
      error
    ) => {
      if (
        error instanceof
        ConnectorError
      ) {
        return {
          code:
            error.code,
          summary:
            error.message,
          retryable:
            error.retryable
        };
      }

      if (
        error instanceof
        CalendarMoveError
      ) {
        return {
          code:
            error.code,
          summary:
            error.message,
          retryable:
            error.retryable
        };
      }

      return {
        code:
          "CALENDAR_CREATE_FAILED",
        summary:
          error instanceof Error
            ? error.message
            : undefined,
        retryable: false
      };
    }
  };
}
