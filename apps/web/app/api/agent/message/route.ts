import {
  latestAssistantText
} from "@skrivebord/agent";
import {
  getOrCreateConversationBinding,
  markAgentRuntimeStatus,
  recordAcceptedAgentRun,
  updateAgentRunStatus,
  withPrincipalTransaction
} from "@skrivebord/database";
import { z } from "zod";
import { databasePool } from "@/lib/database";
import {
  contextFromRoute,
  MojnContextSchema
} from "@/lib/mojn-context";
import {
  getOpenClawGateway,
  openClawRuntimeConfigured
} from "@/lib/openclaw";
import {
  resolveWorkspaceHumanPrincipal
} from "@/lib/principal";

const RequestSchema = z.object({
  workspaceSlug:
    z.string().min(1),
  message:
    z.string()
      .trim()
      .min(1)
      .max(12_000),
  route:
    z.string()
      .max(2048)
      .default("/"),
  idempotencyKey:
    z.string().uuid(),
  context:
    MojnContextSchema.optional()
}).strict();

export async function POST(request: Request) {
  const body =
    await request.json().catch(
      () => null
    );
  const parsed =
    RequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      {
        status: "FAILED",
        humanSummary:
          "Beskeden kunne ikke valideres."
      },
      { status: 400 }
    );
  }

  const principal =
    await resolveWorkspaceHumanPrincipal({
      workspaceSlug:
        parsed.data.workspaceSlug,
      requestId: crypto.randomUUID()
    });

  if (
    !principal ||
    !principal.capabilities.includes(
      "agent.chat"
    )
  ) {
    return Response.json(
      {
        status: "DENIED",
        humanSummary:
          "Du har ikke adgang til Mojn."
      },
      { status: 403 }
    );
  }

  if (!openClawRuntimeConfigured()) {
    return Response.json(
      {
        status: "UNAVAILABLE",
        humanSummary:
          "Mojn kan ikke kontaktes lige nu."
      },
      { status: 503 }
    );
  }

  const context =
    parsed.data.context ??
    contextFromRoute(
      parsed.data.route
    );

  let binding;
  try {
    binding =
      await withPrincipalTransaction(
        databasePool,
        principal,
        ({ db }) =>
          getOrCreateConversationBinding(
            db,
            {
              workspaceId:
                principal.workspaceId,
              runtimeAgentKey:
                "mojn",
              context
            }
          )
      );
  } catch {
    return Response.json(
      {
        status: "NOT_PROVISIONED",
        humanSummary:
          "Mojn er ikke klar til samtaler endnu."
      },
      { status: 409 }
    );
  }

  let accepted;
  try {
    accepted =
      await getOpenClawGateway().sendChat({
        sessionKey:
          binding.openclawSessionKey,
        agentId:
          binding.runtimeAgentKey,
        message:
          parsed.data.message,
        idempotencyKey:
          parsed.data.idempotencyKey,
        queueMode: "followup"
      });
  } catch {
    await withPrincipalTransaction(
      databasePool,
      principal,
      ({ db }) =>
        markAgentRuntimeStatus(
          db,
          {
            workspaceId:
              principal.workspaceId,
            runtimeAgentKey:
              "mojn",
            status:
              "UNAVAILABLE"
          }
        )
    );

    return Response.json(
      {
        status: "UNAVAILABLE",
        humanSummary:
          "Mojn kan ikke kontaktes lige nu. Prøv igen."
      },
      { status: 503 }
    );
  }

  await withPrincipalTransaction(
    databasePool,
    principal,
    async ({ db }) => {
      await recordAcceptedAgentRun(
        db,
        {
          workspaceId:
            principal.workspaceId,
          agentId:
            binding.agentId,
          runtimeAgentKey:
            binding.runtimeAgentKey,
          gatewayRunId:
            accepted.runId,
          sessionKey:
            binding.openclawSessionKey,
          requestedByPrincipalId:
            principal.principalId,
          routeContext:
            parsed.data.route
        }
      );

      await markAgentRuntimeStatus(
        db,
        {
          workspaceId:
            principal.workspaceId,
          runtimeAgentKey:
            "mojn",
          status: "READY",
          seenAt: new Date()
        }
      );
    }
  );

  let wait;
  try {
    wait =
      await getOpenClawGateway().waitForRun({
        runId:
          accepted.runId,
        timeoutMs: 25_000
      });
  } catch {
    await withPrincipalTransaction(
      databasePool,
      principal,
      ({ db }) =>
        updateAgentRunStatus(
          db,
          {
            workspaceId:
              principal.workspaceId,
            gatewayRunId:
              accepted.runId,
            status: "WAITING"
          }
        )
    );

    return Response.json(
      {
        status: "RUNNING",
        humanSummary:
          "Mojn arbejder videre.",
        runId:
          accepted.runId
      },
      { status: 202 }
    );
  }

  if (
    wait.status === "timeout" ||
    wait.status === "pending"
  ) {
    await withPrincipalTransaction(
      databasePool,
      principal,
      ({ db }) =>
        updateAgentRunStatus(
          db,
          {
            workspaceId:
              principal.workspaceId,
            gatewayRunId:
              accepted.runId,
            status: "WAITING"
          }
        )
    );

    return Response.json(
      {
        status: "RUNNING",
        humanSummary:
          "Mojn arbejder videre.",
        runId:
          accepted.runId
      },
      { status: 202 }
    );
  }

  if (wait.status !== "ok") {
    const cancelled =
      wait.stopReason ===
        "superseded" ||
      wait.stopReason ===
        "cancelled";

    await withPrincipalTransaction(
      databasePool,
      principal,
      ({ db }) =>
        updateAgentRunStatus(
          db,
          {
            workspaceId:
              principal.workspaceId,
            gatewayRunId:
              accepted.runId,
            status:
              cancelled
                ? "CANCELLED"
                : "FAILED",
            errorCode:
              wait.stopReason ??
              "OPENCLAW_RUN_ERROR"
          }
        )
    );

    return Response.json(
      {
        status: "FAILED",
        humanSummary:
          cancelled
            ? "Mojn-runnet blev afbrudt."
            : "Mojn kunne ikke færdiggøre svaret.",
        runId:
          accepted.runId
      },
      { status: 502 }
    );
  }

  await withPrincipalTransaction(
    databasePool,
    principal,
    ({ db }) =>
      updateAgentRunStatus(
        db,
        {
          workspaceId:
            principal.workspaceId,
          gatewayRunId:
            accepted.runId,
          status: "SUCCEEDED",
          completedAt:
            wait.endedAt
              ? new Date(
                  wait.endedAt
                )
              : new Date()
        }
      )
  );

  let reply:
    | string
    | undefined;

  try {
    const history =
      await getOpenClawGateway().history({
        sessionKey:
          binding.openclawSessionKey,
        agentId:
          binding.runtimeAgentKey,
        limit: 80
      });

    reply =
      latestAssistantText(
        history
      );
  } catch {
    // The run completion is still authoritative.
    // The UI can refresh history separately.
  }

  return Response.json({
    status: "SUCCEEDED",
    humanSummary:
      "Mojn er færdig.",
    runId:
      accepted.runId,
    reply:
      reply ?? null
  });
}
