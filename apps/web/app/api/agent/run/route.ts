import {
  getAgentRun,
  updateAgentRunStatus,
  withPrincipalTransaction
} from "@skrivebord/database";
import { z } from "zod";
import { databasePool } from "@/lib/database";
import {
  getOpenClawGateway,
  openClawRuntimeConfigured
} from "@/lib/openclaw";
import {
  resolveWorkspaceHumanPrincipal
} from "@/lib/principal";

const QuerySchema = z.object({
  workspaceSlug: z.string().min(1),
  runId: z.string().min(1)
}).strict();

const terminalStates = new Set([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED"
]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    workspaceSlug:
      url.searchParams.get("workspaceSlug"),
    runId:
      url.searchParams.get("runId")
  });

  if (!parsed.success) {
    return Response.json(
      {
        status: "FAILED",
        humanSummary:
          "Run-status kunne ikke valideres."
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

  const localRun =
    await withPrincipalTransaction(
      databasePool,
      principal,
      ({ db }) =>
        getAgentRun(
          db,
          {
            workspaceId:
              principal.workspaceId,
            gatewayRunId:
              parsed.data.runId
          }
        )
    );

  if (!localRun) {
    return Response.json(
      {
        status: "NOT_FOUND",
        humanSummary:
          "Mojn-runnet blev ikke fundet."
      },
      { status: 404 }
    );
  }

  if (
    terminalStates.has(
      localRun.status
    )
  ) {
    return Response.json({
      status:
        localRun.status,
      humanSummary:
        localRun.status ===
        "SUCCEEDED"
          ? "Mojn er færdig."
          : localRun.status ===
              "CANCELLED"
            ? "Mojn-runnet blev afbrudt."
            : "Mojn kunne ikke færdiggøre opgaven."
    });
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

  try {
    const wait =
      await getOpenClawGateway().waitForRun({
        runId:
          parsed.data.runId,
        timeoutMs: 1_500
      });

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
                parsed.data.runId,
              status: "WAITING"
            }
          )
      );

      return Response.json({
        status: "RUNNING",
        humanSummary:
          "Mojn arbejder videre."
      });
    }

    if (wait.status === "ok") {
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
                parsed.data.runId,
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

      return Response.json({
        status: "SUCCEEDED",
        humanSummary:
          "Mojn er færdig."
      });
    }

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
              parsed.data.runId,
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
        status:
          cancelled
            ? "CANCELLED"
            : "FAILED",
        humanSummary:
          cancelled
            ? "Mojn-runnet blev afbrudt."
            : "Mojn kunne ikke færdiggøre opgaven."
      },
      { status: 200 }
    );
  } catch {
    return Response.json(
      {
        status: "UNAVAILABLE",
        humanSummary:
          "Mojn kan ikke kontaktes lige nu."
      },
      { status: 503 }
    );
  }
}
