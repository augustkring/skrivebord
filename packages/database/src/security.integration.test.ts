import { executeAction } from "@skrivebord/actions";
import {
  CompleteWorkItemInputSchema,
  type PrincipalContext
} from "@skrivebord/contracts";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from "vitest";
import {
  actionExecution,
  actionIntent,
  agentProfile,
  auditEvent,
  calendarEvent,
  bindAgentCredential,
  calendarSource,
  connectorAccount,
  connectorCredential,
  createCompleteWorkItemAction,
  getActionStatus,
  getBoundAgentCredential,
  getCalendarMoveTarget,
  getOrCreateConversationBinding,
  createDatabasePool,
  listCalendarEvents,
  listTodayItems,
  persistCalendarSync,
  persistCalendarWriteResult,
  PostgresActionStore,
  recomputeToday,
  readConnectorCredential,
  revokeAgentCredential,
  seedAlsLebenPilotData,
  storeConnectorCredential,
  syncCursor,
  TransactionalPostgresActionStore,
  withPrincipalTransaction,
  workItem,
  workspaceProfile
} from "./index";

const databaseUrl = process.env.DATABASE_TEST_URL;
const adminDatabaseUrl = process.env.DATABASE_URL;
const describeDatabase =
  databaseUrl && adminDatabaseUrl
    ? describe
    : describe.skip;

function principal(
  workspaceId: string,
  requestId: string,
  principalType: PrincipalContext["principalType"] = "SYSTEM"
): PrincipalContext {
  return {
    principalId: `${principalType.toLowerCase()}:database-test`,
    principalType,
    workspaceId,
    roles: [],
    capabilities: ["workspace.read", "today.read", "today.manage"],
    authStrength: "SESSION",
    source: "SYSTEM",
    requestId
  };
}

describeDatabase("database tenant isolation", () => {
  const pool = createDatabasePool(databaseUrl ?? "");
  const adminPool = createDatabasePool(adminDatabaseUrl ?? "");
  const suffix = crypto.randomUUID().slice(0, 8);
  const workspaceA = `test-a-${suffix}`;
  const workspaceB = `test-b-${suffix}`;

  beforeAll(async () => {
    for (const [workspaceId, slug, name] of [
      [workspaceA, `test-a-${suffix}`, "Test A"],
      [workspaceB, `test-b-${suffix}`, "Test B"]
    ] as const) {
      const system = principal(workspaceId, `setup:${workspaceId}`);

      await withPrincipalTransaction(
        pool,
        system,
        async ({ client, db }) => {
          await client.query(
            'insert into "organization" ("id", "name", "slug", "createdAt") values ($1, $2, $3, now())',
            [workspaceId, name, slug]
          );

          await db.insert(workspaceProfile).values({
            workspaceId,
            slug,
            displayName: name
          });
        }
      );
    }
  });

  afterAll(async () => {
    await Promise.all([
      pool.end(),
      adminPool.end()
    ]);
  });

  it("limits unfiltered reads to the principal workspace", async () => {
    const rows = await withPrincipalTransaction(
      pool,
      principal(workspaceA, "read-a"),
      ({ db }) =>
        db
          .select({ workspaceId: workspaceProfile.workspaceId })
          .from(workspaceProfile)
    );

    expect(rows).toEqual([{ workspaceId: workspaceA }]);
  });

  it("rejects a cross-workspace insert through RLS WITH CHECK", async () => {
    await expect(
      withPrincipalTransaction(
        pool,
        principal(workspaceA, "cross-insert"),
        ({ db }) =>
          db.insert(workItem).values({
            workspaceId: workspaceB,
            moduleId: "core",
            kind: "SECURITY_TEST",
            title: "Must not cross tenant",
            reason: "RLS integration test",
            status: "OPEN",
            priorityClass: "TODAY",
            evidence: [],
            agentExecutionMode: "HUMAN_ONLY",
            dedupeFingerprint: `cross:${suffix}`
          })
      )
    ).rejects.toThrow();
  });

  it("persists intent state and audit through the scoped Action Store", async () => {
    const actor = principal(workspaceA, "action-success");

    const result = await withPrincipalTransaction(
      pool,
      actor,
      async ({ db }) => {
        const store = new PostgresActionStore(db, workspaceA);

        return executeAction({
          definition: {
            id: "today.complete",
            input: CompleteWorkItemInputSchema,
            requiredCapabilities: ["today.manage"],
            risk: () => "LOW",
            preview: async () => "Markér arbejdet som færdigt",
            execute: async ({ input }) => ({
              workItemId: input.workItemId,
              status: "DONE" as const
            })
          },
          principal: actor,
          rawInput: {
            workspaceId: workspaceA,
            workItemId: crypto.randomUUID()
          },
          store
        });
      }
    );

    expect(result.status).toBe("SUCCEEDED");
    expect(result.actionId).toBeDefined();

    const stored = await withPrincipalTransaction(
      pool,
      principal(workspaceA, "verify-action"),
      async ({ db }) => {
        const [intent] = await db
          .select()
          .from(actionIntent)
          .where(eq(actionIntent.id, result.actionId!));

        const audits = await db
          .select()
          .from(auditEvent)
          .where(eq(auditEvent.actionIntentId, result.actionId!));

        return { intent, audits };
      }
    );

    expect(stored.intent?.state).toBe("SUCCEEDED");
    expect(stored.audits.at(-1)?.outcome).toBe("SUCCEEDED");
    expect(stored.audits.at(-1)?.requestId).toBe("action-success");
  });


  it("derives pilot operations into persisted Today and completes one through the Action Layer", async () => {
    const actor = principal(workspaceA, "pilot-flow");

    const flow = await withPrincipalTransaction(
      pool,
      actor,
      async ({ db }) => {
        const now = new Date("2026-09-22T08:00:00+02:00");

        await seedAlsLebenPilotData(db, workspaceA, now);
        await recomputeToday(db, workspaceA, now);

        const items = await listTodayItems(db, workspaceA);
        const yearPlan = items.find(
          (item) => item.kind === "YEAR_PLAN"
        );

        if (!yearPlan) {
          throw new Error("EXPECTED_YEAR_PLAN_WORK_ITEM");
        }

        const store = new PostgresActionStore(db, workspaceA);
        const result = await executeAction({
          definition: createCompleteWorkItemAction(db),
          principal: actor,
          rawInput: {
            workspaceId: workspaceA,
            workItemId: yearPlan.id
          },
          store,
          now
        });

        const [completed] = await db
          .select({
            id: workItem.id,
            status: workItem.status,
            completedAt: workItem.completedAt
          })
          .from(workItem)
          .where(eq(workItem.id, yearPlan.id));

        return {
          items,
          result,
          completed
        };
      }
    );

    expect(
      flow.items.some((item) => item.kind === "BOOKING_CONFLICT")
    ).toBe(true);
    expect(
      flow.items.some((item) => item.kind === "GUEST_ARRIVAL_INFO")
    ).toBe(true);
    expect(
      flow.items.some((item) => item.kind === "YEAR_PLAN")
    ).toBe(true);
    expect(flow.result.status).toBe("SUCCEEDED");
    expect(flow.completed?.status).toBe("DONE");
    expect(flow.completed?.completedAt).toBeInstanceOf(Date);

    const audits = await withPrincipalTransaction(
      pool,
      principal(workspaceA, "pilot-flow-audit"),
      ({ db }) =>
        db
          .select()
          .from(auditEvent)
          .where(eq(auditEvent.actionIntentId, flow.result.actionId!))
    );

    expect(audits.at(-1)?.outcome).toBe("SUCCEEDED");
    expect(audits.at(-1)?.requestId).toBe("pilot-flow");
  });


  it("persists provider calendar sync and stores only protected cursor material", async () => {
    const actor = principal(workspaceA, "calendar-sync");

    const stored = await withPrincipalTransaction(
      pool,
      actor,
      async ({ db }) => {
        const [account] = await db
          .insert(connectorAccount)
          .values({
            workspaceId: workspaceA,
            provider: "GOOGLE",
            displayName: "Google Calendar",
            providerAccountId: `google-${suffix}`,
            status: "CONNECTED",
            scopes: ["calendar.events.readonly"],
            connectedBy: actor.principalId
          })
          .returning({ id: connectorAccount.id });

        if (!account) throw new Error("CONNECTOR_ACCOUNT_CREATE_FAILED");

        const [source] = await db
          .insert(calendarSource)
          .values({
            workspaceId: workspaceA,
            provider: "GOOGLE",
            connectorAccountId: account.id,
            providerCalendarId: "primary",
            displayName: "Primær kalender",
            writable: false,
            syncState: "SYNCING"
          })
          .returning({ id: calendarSource.id });

        if (!source) throw new Error("CALENDAR_SOURCE_CREATE_FAILED");

        const result = await persistCalendarSync(db, {
          workspaceId: workspaceA,
          connectorAccountId: account.id,
          calendarSourceId: source.id,
          resourceScope: "primary",
          provider: "GOOGLE",
          mode: "INITIAL",
          result: {
            fullResyncRequired: false,
            cursor: {
              type: "GOOGLE_SYNC_TOKEN",
              value: "raw-sync-token"
            },
            events: [
              {
                providerEventId: "google-event-1",
                providerVersion: "etag-1",
                title: "Google event",
                startAt: "2026-09-25T09:00:00+02:00",
                endAt: "2026-09-25T10:00:00+02:00",
                allDay: false,
                timezone: "Europe/Copenhagen",
                status: "CONFIRMED",
                sourceUpdatedAt: "2026-09-22T10:00:00Z"
              }
            ]
          },
          protectCursor: (raw) => `protected:${raw}`,
          now: new Date("2026-09-22T10:05:00Z")
        });

        const [event] = await db
          .select()
          .from(calendarEvent)
          .where(eq(calendarEvent.providerEventId, "google-event-1"));

        const [cursor] = await db
          .select()
          .from(syncCursor)
          .where(eq(syncCursor.connectorAccountId, account.id));

        return {
          result,
          event,
          cursor
        };
      }
    );

    expect(stored.result).toMatchObject({
      applied: true,
      fullResyncRequired: false,
      itemsSeen: 1,
      itemsCreated: 1
    });
    expect(stored.event?.title).toBe("Google event");
    expect(stored.cursor?.cursorValueProtected).toBe(
      "protected:raw-sync-token"
    );
    expect(stored.cursor?.cursorValueProtected).not.toBe(
      "raw-sync-token"
    );
  });




  it("replaces expanded recurring instances atomically and hides the series master from calendar reads", async () => {
    const actor = principal(
      workspaceA,
      "calendar-recurrence-sync"
    );

    const state =
      await withPrincipalTransaction(
        pool,
        actor,
        async ({ db }) => {
          const [account] =
            await db
              .insert(
                connectorAccount
              )
              .values({
                workspaceId:
                  workspaceA,
                provider: "GOOGLE",
                displayName:
                  "Recurring Google Calendar",
                providerAccountId:
                  `google-recurring-${suffix}`,
                status:
                  "CONNECTED",
                scopes: [
                  "calendar.events"
                ],
                connectedBy:
                  actor.principalId
              })
              .returning({
                id:
                  connectorAccount.id
              });

          if (!account) {
            throw new Error(
              "CONNECTOR_ACCOUNT_CREATE_FAILED"
            );
          }

          const [source] =
            await db
              .insert(
                calendarSource
              )
              .values({
                workspaceId:
                  workspaceA,
                provider: "GOOGLE",
                connectorAccountId:
                  account.id,
                providerCalendarId:
                  `recurring-${suffix}`,
                displayName:
                  "Recurring calendar",
                writable: true,
                syncState:
                  "CONNECTED"
              })
              .returning({
                id:
                  calendarSource.id
              });

          if (!source) {
            throw new Error(
              "CALENDAR_SOURCE_CREATE_FAILED"
            );
          }

          const masterId =
            `series-${suffix}`;

          await persistCalendarSync(
            db,
            {
              workspaceId:
                workspaceA,
              connectorAccountId:
                account.id,
              calendarSourceId:
                source.id,
              resourceScope:
                source.id,
              provider: "GOOGLE",
              mode: "INITIAL",
              result: {
                fullResyncRequired:
                  false,
                cursor: {
                  type:
                    "GOOGLE_SYNC_TOKEN",
                  value:
                    "recurring-sync-1"
                },
                events: [
                  {
                    providerEventId:
                      masterId,
                    providerVersion:
                      "master-v1",
                    title:
                      "Ugentlig rengøring",
                    startAt:
                      "2026-09-25T08:00:00Z",
                    endAt:
                      "2026-09-25T09:00:00Z",
                    allDay: false,
                    timezone:
                      "Europe/Copenhagen",
                    recurrenceRule:
                      "RRULE:FREQ=WEEKLY",
                    status:
                      "CONFIRMED"
                  },
                  {
                    providerEventId:
                      `old-instance-${suffix}`,
                    providerVersion:
                      "instance-v1",
                    title:
                      "Ugentlig rengøring",
                    startAt:
                      "2026-10-02T08:00:00Z",
                    endAt:
                      "2026-10-02T09:00:00Z",
                    allDay: false,
                    timezone:
                      "Europe/Copenhagen",
                    recurrenceMasterId:
                      masterId,
                    recurrenceOriginalStartAt:
                      "2026-10-02T08:00:00Z",
                    status:
                      "CONFIRMED"
                  }
                ]
              },
              replaceSeriesMasterIds: [
                masterId
              ],
              protectCursor:
                (raw) =>
                  `protected:${raw}`
            }
          );

          await persistCalendarSync(
            db,
            {
              workspaceId:
                workspaceA,
              connectorAccountId:
                account.id,
              calendarSourceId:
                source.id,
              resourceScope:
                source.id,
              provider: "GOOGLE",
              mode:
                "INCREMENTAL",
              result: {
                fullResyncRequired:
                  false,
                cursor: {
                  type:
                    "GOOGLE_SYNC_TOKEN",
                  value:
                    "recurring-sync-2"
                },
                events: [
                  {
                    providerEventId:
                      masterId,
                    providerVersion:
                      "master-v2",
                    title:
                      "Ugentlig rengøring",
                    startAt:
                      "2026-09-25T09:00:00Z",
                    endAt:
                      "2026-09-25T10:00:00Z",
                    allDay: false,
                    timezone:
                      "Europe/Copenhagen",
                    recurrenceRule:
                      "RRULE:FREQ=WEEKLY",
                    status:
                      "CONFIRMED"
                  },
                  {
                    providerEventId:
                      `new-instance-${suffix}`,
                    providerVersion:
                      "instance-v2",
                    title:
                      "Ugentlig rengøring",
                    startAt:
                      "2026-10-02T09:00:00Z",
                    endAt:
                      "2026-10-02T10:00:00Z",
                    allDay: false,
                    timezone:
                      "Europe/Copenhagen",
                    recurrenceMasterId:
                      masterId,
                    recurrenceOriginalStartAt:
                      "2026-10-02T09:00:00Z",
                    status:
                      "CONFIRMED"
                  }
                ]
              },
              replaceSeriesMasterIds: [
                masterId
              ],
              protectCursor:
                (raw) =>
                  `protected:${raw}`
            }
          );

          const visible =
            await listCalendarEvents(
              db,
              workspaceA
            );

          const raw =
            await db
              .select({
                providerEventId:
                  calendarEvent
                    .providerEventId,
                recurrenceMasterId:
                  calendarEvent
                    .recurrenceMasterId,
                recurrenceOriginalStartAt:
                  calendarEvent
                    .recurrenceOriginalStartAt
              })
              .from(
                calendarEvent
              )
              .where(
                eq(
                  calendarEvent
                    .calendarSourceId,
                  source.id
                )
              );

          return {
            masterId,
            visible,
            raw
          };
        }
      );

    expect(
      state.raw.some(
        (event) =>
          event.providerEventId ===
          `old-instance-${suffix}`
      )
    ).toBe(false);

    expect(
      state.raw.some(
        (event) =>
          event.providerEventId ===
          `new-instance-${suffix}` &&
          event
            .recurrenceOriginalStartAt
            ?.toISOString() ===
            "2026-10-02T09:00:00.000Z"
      )
    ).toBe(true);

    expect(
      state.visible.some(
        (event) =>
          event.providerEventId ===
          state.masterId
      )
    ).toBe(false);

    expect(
      state.visible.some(
        (event) =>
          event.providerEventId ===
          `new-instance-${suffix}`
      )
    ).toBe(true);
  });

  it("resolves and persists calendar write targets inside the active tenant only", async () => {
    const actor = principal(
      workspaceA,
      "calendar-write-target",
      "SYSTEM"
    );

    const created =
      await withPrincipalTransaction(
        pool,
        actor,
        async ({ db }) => {
          const [account] =
            await db
              .insert(
                connectorAccount
              )
              .values({
                workspaceId:
                  workspaceA,
                provider: "GOOGLE",
                displayName:
                  "Writable Google Calendar",
                providerAccountId:
                  `google-write-${suffix}`,
                status:
                  "CONNECTED",
                scopes: [
                  "calendar.events"
                ],
                connectedBy:
                  actor.principalId
              })
              .returning({
                id:
                  connectorAccount.id
              });

          if (!account) {
            throw new Error(
              "CONNECTOR_ACCOUNT_CREATE_FAILED"
            );
          }

          const [source] =
            await db
              .insert(
                calendarSource
              )
              .values({
                workspaceId:
                  workspaceA,
                provider: "GOOGLE",
                connectorAccountId:
                  account.id,
                providerCalendarId:
                  `write-${suffix}`,
                displayName:
                  "Writable calendar",
                writable: true,
                syncState:
                  "CONNECTED"
              })
              .returning({
                id:
                  calendarSource.id
              });

          if (!source) {
            throw new Error(
              "CALENDAR_SOURCE_CREATE_FAILED"
            );
          }

          const [event] =
            await db
              .insert(
                calendarEvent
              )
              .values({
                workspaceId:
                  workspaceA,
                calendarSourceId:
                  source.id,
                providerEventId:
                  `provider-write-${suffix}`,
                providerVersion:
                  "etag-before",
                title:
                  "Flytbar rengøring",
                startAt:
                  new Date(
                    "2026-09-25T08:00:00Z"
                  ),
                endAt:
                  new Date(
                    "2026-09-25T09:00:00Z"
                  ),
                allDay: false,
                timezone:
                  "Europe/Copenhagen",
                status:
                  "CONFIRMED",
                category:
                  "EXTERNAL",
                originActorType:
                  "SYSTEM",
                originActorId:
                  actor.principalId
              })
              .returning({
                id:
                  calendarEvent.id
              });

          if (!event) {
            throw new Error(
              "CALENDAR_EVENT_CREATE_FAILED"
            );
          }

          return {
            accountId:
              account.id,
            sourceId:
              source.id,
            eventId:
              event.id
          };
        }
      );

    const target =
      await withPrincipalTransaction(
        pool,
        actor,
        ({ db }) =>
          getCalendarMoveTarget(
            db,
            {
              workspaceId:
                workspaceA,
              eventId:
                created.eventId,
              scope:
                "OCCURRENCE"
            }
          )
      );

    expect(target).toMatchObject({
      localTargetEventId:
        created.eventId,
      calendarSourceId:
        created.sourceId,
      connectorAccountId:
        created.accountId,
      provider:
        "GOOGLE",
      providerVersion:
        "etag-before",
      writable: true,
      syncState:
        "CONNECTED"
    });

    const crossTenant =
      await withPrincipalTransaction(
        pool,
        principal(
          workspaceB,
          "calendar-write-cross-tenant",
          "SYSTEM"
        ),
        ({ db }) =>
          getCalendarMoveTarget(
            db,
            {
              workspaceId:
                workspaceB,
              eventId:
                created.eventId,
              scope:
                "OCCURRENCE"
            }
          )
      );

    expect(
      crossTenant
    ).toBeUndefined();

    await withPrincipalTransaction(
      pool,
      actor,
      ({ db }) =>
        persistCalendarWriteResult(
          db,
          {
            workspaceId:
              workspaceA,
            localTargetEventId:
              created.eventId,
            providerResult: {
              providerEventId:
                `provider-write-${suffix}`,
              providerVersion:
                "etag-after",
              title:
                "Flytbar rengøring",
              startAt:
                "2026-09-25T10:00:00Z",
              endAt:
                "2026-09-25T11:00:00Z",
              allDay: false,
              timezone:
                "Europe/Copenhagen",
              status:
                "CONFIRMED"
            },
            now:
              new Date(
                "2026-09-23T12:00:00Z"
              )
          }
        )
    );

    const [stored] =
      await withPrincipalTransaction(
        pool,
        actor,
        ({ db }) =>
          db
            .select()
            .from(
              calendarEvent
            )
            .where(
              eq(
                calendarEvent.id,
                created.eventId
              )
            )
      );

    expect(
      stored?.providerVersion
    ).toBe("etag-after");
    expect(
      stored?.startAt?.toISOString()
    ).toBe(
      "2026-09-25T10:00:00.000Z"
    );
    expect(
      stored?.endAt?.toISOString()
    ).toBe(
      "2026-09-25T11:00:00.000Z"
    );
    expect(
      stored?.localVersion
    ).toBe(2);
  });

  it("keeps connector credential payloads invisible to HUMAN and AGENT principals", async () => {
    const system = principal(
      workspaceA,
      "credential-write",
      "SYSTEM"
    );

    const connectorAccountId = await withPrincipalTransaction(
      pool,
      system,
      async ({ db }) => {
        const [account] = await db
          .insert(connectorAccount)
          .values({
            workspaceId: workspaceA,
            provider: "GOOGLE",
            displayName: "Credential isolation account",
            providerAccountId: `credential-isolation-${suffix}`,
            status: "CONNECTED",
            scopes: ["calendar.events"],
            connectedBy: system.principalId
          })
          .returning({ id: connectorAccount.id });

        if (!account) {
          throw new Error("CONNECTOR_ACCOUNT_CREATE_FAILED");
        }

        await storeConnectorCredential(db, {
          workspaceId: workspaceA,
          connectorAccountId: account.id,
          encryptedPayload: "v1.k1.fake-protected-payload",
          keyId: "k1"
        });

        const stored = await readConnectorCredential(db, {
          workspaceId: workspaceA,
          connectorAccountId: account.id
        });

        expect(stored?.encryptedPayload).toBe(
          "v1.k1.fake-protected-payload"
        );

        return account.id;
      }
    );

    for (const principalType of ["HUMAN", "AGENT"] as const) {
      const rows = await withPrincipalTransaction(
        pool,
        principal(
          workspaceA,
          `credential-read-${principalType.toLowerCase()}`,
          principalType
        ),
        ({ db }) =>
          db
            .select({
              encryptedPayload: connectorCredential.encryptedPayload
            })
            .from(connectorCredential)
            .where(
              eq(
                connectorCredential.connectorAccountId,
                connectorAccountId
              )
            )
      );

      expect(rows).toEqual([]);
    }
  });


  it("enforces one active agent credential and supports atomic rotation", async () => {
    const system = principal(
      workspaceA,
      "agent-credential-lifecycle",
      "SYSTEM"
    );

    const oldKeyId =
      `key-old-${suffix}`;
    const conflictKeyId =
      `key-conflict-${suffix}`;
    const newKeyId =
      `key-new-${suffix}`;

    for (const keyId of [
      oldKeyId,
      conflictKeyId,
      newKeyId
    ]) {
      await adminPool.query(
        'insert into "apikey" ("id", "configId", "name", "referenceId", "key", "enabled", "createdAt", "updatedAt") values ($1, $2, $3, $4, $5, true, now(), now())',
        [
          keyId,
          "agent-keys",
          "Mojn test",
          workspaceA,
          `hashed-${keyId}`
        ]
      );
    }

    const first =
      await withPrincipalTransaction(
        pool,
        system,
        ({ db }) =>
          bindAgentCredential(
            db,
            {
              workspaceId:
                workspaceA,
              name: "Mojn",
              runtimeAgentKey:
                `mojn-${suffix}`,
              apiKeyId: oldKeyId,
              capabilities: [
                "today.read",
                "today.manage"
              ]
            }
          )
      );

    await expect(
      withPrincipalTransaction(
        pool,
        system,
        ({ db }) =>
          bindAgentCredential(
            db,
            {
              workspaceId:
                workspaceA,
              name: "Mojn",
              runtimeAgentKey:
                `mojn-${suffix}`,
              apiKeyId:
                conflictKeyId,
              capabilities: [
                "today.read"
              ]
            }
          )
      )
    ).rejects.toThrow();

    const stillActive =
      await withPrincipalTransaction(
        pool,
        system,
        ({ db }) =>
          getBoundAgentCredential(
            db,
            {
              workspaceId:
                workspaceA,
              apiKeyId:
                first.apiKeyId
            }
          )
      );

    expect(
      stillActive?.apiKeyId
    ).toBe(first.apiKeyId);

    const second =
      await withPrincipalTransaction(
        pool,
        system,
        async ({ db }) => {
          await revokeAgentCredential(
            db,
            {
              workspaceId:
                workspaceA,
              apiKeyId:
                first.apiKeyId
            }
          );

          return bindAgentCredential(
            db,
            {
              workspaceId:
                workspaceA,
              name: "Mojn",
              runtimeAgentKey:
                `mojn-${suffix}`,
              apiKeyId:
                newKeyId,
              capabilities: [
                "today.read",
                "today.manage"
              ]
            }
          );
        }
      );

    const [oldAfterRotation, newAfterRotation] =
      await Promise.all([
        withPrincipalTransaction(
          pool,
          system,
          ({ db }) =>
            getBoundAgentCredential(
              db,
              {
                workspaceId:
                  workspaceA,
                apiKeyId:
                  first.apiKeyId
              }
            )
        ),
        withPrincipalTransaction(
          pool,
          system,
          ({ db }) =>
            getBoundAgentCredential(
              db,
              {
                workspaceId:
                  workspaceA,
                apiKeyId:
                  second.apiKeyId
              }
            )
        )
      ]);

    expect(
      oldAfterRotation
    ).toBeUndefined();
    expect(
      newAfterRotation?.apiKeyId
    ).toBe(second.apiKeyId);
  });


  it("isolates OpenClaw sessions by workspace, agent and business context", async () => {
    const runtimeAgentKey =
      `mojn-session-${suffix}`;
    const bookingId =
      crypto.randomUUID();
    const propertyId =
      crypto.randomUUID();

    for (const workspaceId of [
      workspaceA,
      workspaceB
    ]) {
      await withPrincipalTransaction(
        pool,
        principal(
          workspaceId,
          `session-agent-${workspaceId}`,
          "SYSTEM"
        ),
        ({ db }) =>
          db
            .insert(agentProfile)
            .values({
              workspaceId,
              name: "Mojn",
              runtimeType:
                "OPENCLAW",
              runtimeAgentKey,
              enabled: true,
              status: "READY"
            })
      );
    }

    const bindingsA =
      await withPrincipalTransaction(
        pool,
        principal(
          workspaceA,
          "conversation-a",
          "SYSTEM"
        ),
        async ({ db }) => {
          const generalOne =
            await getOrCreateConversationBinding(
              db,
              {
                workspaceId:
                  workspaceA,
                runtimeAgentKey,
                context: {
                  type: "GENERAL"
                }
              }
            );

          const generalTwo =
            await getOrCreateConversationBinding(
              db,
              {
                workspaceId:
                  workspaceA,
                runtimeAgentKey,
                context: {
                  type: "GENERAL"
                }
              }
            );

          const booking =
            await getOrCreateConversationBinding(
              db,
              {
                workspaceId:
                  workspaceA,
                runtimeAgentKey,
                context: {
                  type: "BOOKING",
                  id: bookingId
                }
              }
            );

          const property =
            await getOrCreateConversationBinding(
              db,
              {
                workspaceId:
                  workspaceA,
                runtimeAgentKey,
                context: {
                  type: "PROPERTY",
                  id: propertyId
                }
              }
            );

          return {
            generalOne,
            generalTwo,
            booking,
            property
          };
        }
      );

    const generalB =
      await withPrincipalTransaction(
        pool,
        principal(
          workspaceB,
          "conversation-b",
          "SYSTEM"
        ),
        ({ db }) =>
          getOrCreateConversationBinding(
            db,
            {
              workspaceId:
                workspaceB,
              runtimeAgentKey,
              context: {
                type: "GENERAL"
              }
            }
          )
      );

    expect(
      bindingsA.generalOne
        .openclawSessionKey
    ).toBe(
      bindingsA.generalTwo
        .openclawSessionKey
    );

    expect(
      new Set([
        bindingsA.generalOne
          .openclawSessionKey,
        bindingsA.booking
          .openclawSessionKey,
        bindingsA.property
          .openclawSessionKey,
        generalB.openclawSessionKey
      ]).size
    ).toBe(4);

    expect(
      bindingsA.booking.contextKey
    ).toBe(
      `BOOKING:${bookingId.toLowerCase()}`
    );

    expect(
      bindingsA.property.contextKey
    ).toBe(
      `PROPERTY:${propertyId.toLowerCase()}`
    );
  });


  it("allows only one side effect for concurrent retries with the same idempotency key", async () => {
    const actor = principal(
      workspaceA,
      "idempotency-race"
    );

    let sideEffects = 0;

    const definition = {
      id: "calendar.external.test",
      input: CompleteWorkItemInputSchema,
      requiredCapabilities: [
        "today.manage"
      ],
      risk: () => "LOW" as const,
      idempotency:
        "REQUIRED" as const,
      externalEffectRefs: (
        result: {
          providerRef: string;
        }
      ) => [
        result.providerRef
      ],
      execute: async () => {
        sideEffects += 1;

        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              40
            )
        );

        return {
          providerRef:
            "provider:event:1"
        };
      }
    };

    const workItemId =
      crypto.randomUUID();

    const run = () =>
      executeAction({
        definition,
        principal: actor,
        rawInput: {
          workspaceId:
            workspaceA,
          workItemId
        },
        idempotencyKey:
          `race-${suffix}`,
        store:
          new TransactionalPostgresActionStore(
            pool,
            actor
          )
      });

    const [first, second] =
      await Promise.all([
        run(),
        run()
      ]);

    expect(sideEffects).toBe(1);

    const statuses = [
      first.status,
      second.status
    ];

    expect(
      statuses.filter(
        (status) =>
          status ===
          "SUCCEEDED"
      )
    ).toHaveLength(1);

    expect(
      statuses.some(
        (status) =>
          status ===
          "CONFLICT"
      )
    ).toBe(true);

    const replay =
      await run();

    expect(
      replay.status
    ).toBe("SUCCEEDED");
    expect(
      replay.data
    ).toEqual({
      providerRef:
        "provider:event:1"
    });
    expect(sideEffects).toBe(1);

    const actionStatus =
      await withPrincipalTransaction(
        pool,
        actor,
        ({ db }) =>
          getActionStatus(
            db,
            {
              workspaceId:
                workspaceA,
              actionIntentId:
                replay.actionId!,
              requestedByPrincipalId:
                actor.principalId
            }
          )
      );

    expect(
      actionStatus?.state
    ).toBe("SUCCEEDED");
    expect(
      actionStatus?.execution
        ?.externalEffectRefs
    ).toEqual([
      "provider:event:1"
    ]);

    const hiddenFromOtherPrincipal =
      await withPrincipalTransaction(
        pool,
        principal(
          workspaceA,
          "status-other-principal",
          "SYSTEM"
        ),
        ({ db }) =>
          getActionStatus(
            db,
            {
              workspaceId:
                workspaceA,
              actionIntentId:
                replay.actionId!,
              requestedByPrincipalId:
                "system:someone-else"
            }
          )
      );

    expect(
      hiddenFromOtherPrincipal
    ).toBeUndefined();

    const executions =
      await withPrincipalTransaction(
        pool,
        actor,
        ({ db }) =>
          db
            .select()
            .from(
              actionExecution
            )
            .where(
              eq(
                actionExecution
                  .idempotencyKey,
                `race-${suffix}`
              )
            )
      );

    expect(executions).toHaveLength(1);
    expect(
      executions[0]?.state
    ).toBe("SUCCEEDED");
    expect(
      executions[0]
        ?.externalEffectRefs
    ).toEqual([
      "provider:event:1"
    ]);
  });

  it("keeps audit append-only for the application role", async () => {
    const actor = principal(workspaceA, "audit-write");
    let auditId = "";

    await withPrincipalTransaction(pool, actor, async ({ db }) => {
      const store = new PostgresActionStore(db, workspaceA);
      const result = await executeAction({
        definition: {
          id: "today.complete",
          input: CompleteWorkItemInputSchema,
          requiredCapabilities: ["today.manage"],
          risk: () => "LOW",
          execute: async () => ({ ok: true })
        },
        principal: actor,
        rawInput: {
          workspaceId: workspaceA,
          workItemId: crypto.randomUUID()
        },
        store
      });

      const [row] = await db
        .select({ id: auditEvent.id })
        .from(auditEvent)
        .where(eq(auditEvent.actionIntentId, result.actionId!));

      auditId = row?.id ?? "";
    });

    expect(auditId).not.toBe("");

    await expect(
      withPrincipalTransaction(
        pool,
        principal(workspaceA, "audit-tamper"),
        ({ db }) =>
          db
            .update(auditEvent)
            .set({ outcome: "TAMPERED" })
            .where(eq(auditEvent.id, auditId))
      )
    ).rejects.toThrow();
  });
});
