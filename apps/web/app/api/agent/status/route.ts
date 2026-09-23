import {
  getAgentProvisioningState,
  markAgentRuntimeStatus,
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
  workspaceSlug: z.string().min(1)
}).strict();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    workspaceSlug:
      url.searchParams.get("workspaceSlug")
  });

  if (!parsed.success) {
    return Response.json(
      {
        status: "INVALID_REQUEST",
        humanSummary:
          "Workspace kunne ikke valideres."
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

  const agentState =
    await withPrincipalTransaction(
      databasePool,
      principal,
      ({ db }) =>
        getAgentProvisioningState(
          db,
          {
            workspaceId:
              principal.workspaceId,
            runtimeAgentKey: "mojn"
          }
        )
    );

  if (
    !agentState?.enabled ||
    !agentState.activeCredential
  ) {
    return Response.json({
      status: "NOT_PROVISIONED",
      humanSummary:
        "Mojn er ikke provisioneret endnu."
    });
  }

  if (!openClawRuntimeConfigured()) {
    return Response.json({
      status: "UNAVAILABLE",
      humanSummary:
        "Mojn-runtime er ikke konfigureret."
    });
  }

  const runtime =
    await getOpenClawGateway().status();

  await withPrincipalTransaction(
    databasePool,
    principal,
    ({ db }) =>
      markAgentRuntimeStatus(
        db,
        {
          workspaceId:
            principal.workspaceId,
          runtimeAgentKey: "mojn",
          status:
            runtime.status === "READY"
              ? "READY"
              : "UNAVAILABLE",
          seenAt:
            runtime.status === "READY"
              ? new Date()
              : undefined
        }
      )
  );

  return Response.json({
    status:
      runtime.status === "READY"
        ? "READY"
        : "UNAVAILABLE",
    humanSummary:
      runtime.status === "READY"
        ? "Mojn kører normalt."
        : "Mojn kan ikke kontaktes lige nu.",
    protocolVersion:
      runtime.status === "READY"
        ? runtime.protocolVersion
        : undefined
  });
}
