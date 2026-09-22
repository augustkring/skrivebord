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
  actionIntent,
  auditEvent,
  createDatabasePool,
  PostgresActionStore,
  withPrincipalTransaction,
  workItem,
  workspaceProfile
} from "./index";

const databaseUrl = process.env.DATABASE_TEST_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

function principal(
  workspaceId: string,
  requestId: string
): PrincipalContext {
  return {
    principalId: "system:database-test",
    principalType: "SYSTEM",
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
    await pool.end();
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
