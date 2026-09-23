import {
  normalizeOpenClawHistory
} from "@skrivebord/agent";
import {
  getOrCreateConversationBinding,
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

const QuerySchema = z.object({
  workspaceSlug: z.string().min(1),
  route: z.string().max(2048).default("/"),
  context: z.string().optional()
}).strict();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    workspaceSlug:
      url.searchParams.get("workspaceSlug"),
    route:
      url.searchParams.get("route") ??
      "/",
    context:
      url.searchParams.get("context") ??
      undefined
  });

  if (!parsed.success) {
    return Response.json(
      {
        status: "FAILED",
        humanSummary:
          "Samtalekonteksten kunne ikke valideres."
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
          "Mojn kan ikke kontaktes lige nu.",
        messages: []
      },
      { status: 503 }
    );
  }

  let explicitContext:
    | z.infer<
        typeof MojnContextSchema
      >
    | undefined;

  if (parsed.data.context) {
    try {
      explicitContext =
        MojnContextSchema.parse(
          JSON.parse(
            parsed.data.context
          )
        );
    } catch {
      return Response.json(
        {
          status: "FAILED",
          humanSummary:
            "Samtalekonteksten kunne ikke valideres."
        },
        { status: 400 }
      );
    }
  }

  const context =
    explicitContext ??
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
          "Mojn er ikke klar til samtaler endnu.",
        messages: []
      },
      { status: 409 }
    );
  }

  try {
    const history =
      await getOpenClawGateway().history({
        sessionKey:
          binding.openclawSessionKey,
        agentId:
          binding.runtimeAgentKey,
        limit: 80
      });

    return Response.json({
      status: "READY",
      humanSummary:
        "Samtalen blev hentet.",
      messages:
        normalizeOpenClawHistory(
          history
        ),
      running:
        history.sessionInfo
          ?.hasActiveRun ??
        false
    });
  } catch {
    return Response.json(
      {
        status: "UNAVAILABLE",
        humanSummary:
          "Mojn kan ikke kontaktes lige nu.",
        messages: []
      },
      { status: 503 }
    );
  }
}
