import {
  ConnectorError,
  GoogleCalendarConnector
} from "@skrivebord/connectors";
import {
  clearCalendarSourceForFullResync,
  persistCalendarSync,
  recordCalendarSyncFailure,
  withPrincipalTransaction
} from "@skrivebord/database";
import { databasePool } from "./database";
import { getGoogleAccessContext } from "./google-access";

function initialWindow(now: Date): {
  timeMin: string;
  timeMax: string;
} {
  return {
    timeMin: new Date(
      now.getTime() - 90 * 24 * 60 * 60 * 1000
    ).toISOString(),
    timeMax: new Date(
      now.getTime() + 548 * 24 * 60 * 60 * 1000
    ).toISOString()
  };
}

async function expandRecurringInstances(input: {
  connector: GoogleCalendarConnector;
  accessToken: string;
  calendarId: string;
  result: Awaited<
    ReturnType<
      GoogleCalendarConnector["initialSync"]
    >
  >;
  now: Date;
}) {
  const masters =
    input.result.events.filter(
      (event) =>
        Boolean(
          event.recurrenceRule
        ) &&
        !event
          .recurrenceMasterId &&
        event.status ===
          "CONFIRMED"
    );

  if (masters.length === 0) {
    return {
      result: input.result,
      replaceSeriesMasterIds:
        [] as string[]
    };
  }

  const window =
    initialWindow(input.now);

  const expanded =
    await Promise.all(
      masters.map(
        async (master) => ({
          masterId:
            master.providerEventId,
          instances:
            await input.connector
              .listEventInstances({
                accessToken:
                  input.accessToken,
                calendarId:
                  input.calendarId,
                eventId:
                  master
                    .providerEventId,
                ...window
              })
        })
      )
    );

  const byProviderId =
    new Map(
      input.result.events.map(
        (event) => [
          event.providerEventId,
          event
        ]
      )
    );

  for (
    const series of expanded
  ) {
    for (
      const instance of
      series.instances
    ) {
      byProviderId.set(
        instance.providerEventId,
        instance
      );
    }
  }

  return {
    result: {
      ...input.result,
      events: [
        ...byProviderId.values()
      ]
    },
    replaceSeriesMasterIds:
      expanded.map(
        (series) =>
          series.masterId
      )
  };
}

export type GoogleCalendarSyncSummary = {
  connectorAccountId: string;
  calendarsAttempted: number;
  calendarsSucceeded: number;
  calendarsFailed: number;
  fullResyncs: number;
  eventsSeen: number;
  eventsCreated: number;
  eventsUpdated: number;
  eventsDeleted: number;
};

export async function runGoogleCalendarSync(input: {
  workspaceId: string;
  sourceIds?: string[];
  now?: Date;
}): Promise<GoogleCalendarSyncSummary> {
  const {
    now,
    systemPrincipal,
    context,
    tokens,
    protector
  } = await getGoogleAccessContext({
    workspaceId: input.workspaceId,
    jobId: "system:google-calendar-sync",
    now: input.now
  });

  const connector = new GoogleCalendarConnector();

  const selectedSources =
    input.sourceIds && input.sourceIds.length > 0
      ? context.sources.filter((source) =>
          input.sourceIds?.includes(source.id)
        )
      : context.sources;

  const summary: GoogleCalendarSyncSummary = {
    connectorAccountId: context.account.id,
    calendarsAttempted: selectedSources.length,
    calendarsSucceeded: 0,
    calendarsFailed: 0,
    fullResyncs: 0,
    eventsSeen: 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    eventsDeleted: 0
  };

  const cursorByScope = new Map(
    context.cursors.map((cursor) => [
      cursor.resourceScope,
      cursor
    ])
  );

  for (const source of selectedSources) {
    const cursorRow = cursorByScope.get(
      source.providerCalendarId
    );
    let mode: "INITIAL" | "INCREMENTAL" =
      cursorRow ? "INCREMENTAL" : "INITIAL";

    try {
      let syncResult;

      if (cursorRow) {
        const rawCursor = protector.unprotect(
          cursorRow.cursorValueProtected
        );

        syncResult = await connector.incrementalSync({
          accessToken: tokens.accessToken,
          calendarId: source.providerCalendarId,
          cursor: {
            type: "GOOGLE_SYNC_TOKEN",
            value: rawCursor
          }
        });
      } else {
        const window = initialWindow(now);
        syncResult = await connector.initialSync({
          accessToken: tokens.accessToken,
          calendarId: source.providerCalendarId,
          ...window
        });
      }

      if (syncResult.fullResyncRequired) {
        summary.fullResyncs += 1;
        mode = "INITIAL";

        await withPrincipalTransaction(
          databasePool,
          systemPrincipal,
          ({ db }) =>
            clearCalendarSourceForFullResync(db, {
              workspaceId: input.workspaceId,
              connectorAccountId:
                context.account.id,
              calendarSourceId: source.id,
              resourceScope:
                source.providerCalendarId,
              now
            })
        );

        const window = initialWindow(now);
        syncResult = await connector.initialSync({
          accessToken: tokens.accessToken,
          calendarId: source.providerCalendarId,
          ...window
        });
      }

      const expanded =
        await expandRecurringInstances({
          connector,
          accessToken:
            tokens.accessToken,
          calendarId:
            source.providerCalendarId,
          result:
            syncResult,
          now
        });

      const persisted =
        await withPrincipalTransaction(
          databasePool,
          systemPrincipal,
          ({ db }) =>
            persistCalendarSync(db, {
              workspaceId: input.workspaceId,
              connectorAccountId:
                context.account.id,
              calendarSourceId: source.id,
              resourceScope:
                source.providerCalendarId,
              provider: "GOOGLE",
              mode,
              result:
                expanded.result,
              replaceSeriesMasterIds:
                expanded
                  .replaceSeriesMasterIds,
              protectCursor: (raw) =>
                protector.protect(raw),
              now
            })
        );

      summary.calendarsSucceeded += 1;
      summary.eventsSeen += persisted.itemsSeen;
      summary.eventsCreated +=
        persisted.itemsCreated;
      summary.eventsUpdated +=
        persisted.itemsUpdated;
      summary.eventsDeleted +=
        persisted.itemsDeleted;
    } catch (error) {
      summary.calendarsFailed += 1;

      const connectorError =
        error instanceof ConnectorError
          ? error
          : undefined;

      await withPrincipalTransaction(
        databasePool,
        systemPrincipal,
        ({ db }) =>
          recordCalendarSyncFailure(db, {
            workspaceId: input.workspaceId,
            connectorAccountId:
              context.account.id,
            calendarSourceId: source.id,
            mode,
            failureCode:
              connectorError?.code ??
              "SYNC_FAILED",
            authExpired:
              connectorError?.code === "AUTH_EXPIRED",
            now
          })
      );

      if (connectorError?.code === "AUTH_EXPIRED") {
        break;
      }
    }
  }

  return summary;
}
