import {
  getOrCreateConversationBinding,
  withPrincipalTransaction
} from "@skrivebord/database";
import { z } from "zod";
import { databasePool } from "@/lib/database";
import {
  contextFromRoute
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
  route: z.string().max(2048).default("/")
}).strict();

function readSessionKey(
  value: unknown
): string | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }

  const record =
    value as Record<string, unknown>;

  if (
    typeof record.sessionKey ===
    "string"
  ) {
    return record.sessionKey;
  }

  for (const key of [
    "run",
    "message",
    "session"
  ]) {
    const nested =
      record[key];

    if (
      typeof nested !== "object" ||
      nested === null ||
      Array.isArray(nested)
    ) {
      continue;
    }

    const nestedRecord =
      nested as Record<
        string,
        unknown
      >;

    if (
      typeof nestedRecord
        .sessionKey === "string"
    ) {
      return nestedRecord.sessionKey;
    }

    if (
      key === "session" &&
      typeof nestedRecord.key ===
        "string"
    ) {
      return nestedRecord.key;
    }
  }

  return undefined;
}

function encodeSse(
  event: string,
  data: unknown
): Uint8Array {
  const encoder =
    new TextEncoder();

  return encoder.encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed =
    QuerySchema.safeParse({
      workspaceSlug:
        url.searchParams.get(
          "workspaceSlug"
        ),
      route:
        url.searchParams.get(
          "route"
        ) ?? "/"
    });

  if (!parsed.success) {
    return Response.json(
      {
        error:
          "INVALID_AGENT_EVENT_CONTEXT"
      },
      { status: 400 }
    );
  }

  const principal =
    await resolveWorkspaceHumanPrincipal({
      workspaceSlug:
        parsed.data.workspaceSlug,
      requestId:
        crypto.randomUUID()
    });

  if (
    !principal ||
    !principal.capabilities.includes(
      "agent.chat"
    )
  ) {
    return Response.json(
      { error: "FORBIDDEN" },
      { status: 403 }
    );
  }

  if (!openClawRuntimeConfigured()) {
    return Response.json(
      { error: "UNAVAILABLE" },
      { status: 503 }
    );
  }

  const context =
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
      { error: "NOT_PROVISIONED" },
      { status: 409 }
    );
  }

  const gateway =
    getOpenClawGateway();

  try {
    await gateway.connect();
  } catch {
    return Response.json(
      { error: "UNAVAILABLE" },
      { status: 503 }
    );
  }

  const sessionKey =
    binding.openclawSessionKey;

  const stream =
    new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;

        const cleanup = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          clearInterval(keepalive);

          try {
            controller.close();
          } catch {
            // Stream may already be closed.
          }
        };

        const unsubscribe =
          gateway.subscribe(
            (event) => {
              if (
                readSessionKey(
                  event.payload
                ) !== sessionKey
              ) {
                return;
              }

              controller.enqueue(
                encodeSse(
                  "changed",
                  {
                    event:
                      event.event,
                    seq:
                      event.seq ??
                      null
                  }
                )
              );
            }
          );

        const keepalive =
          setInterval(() => {
            controller.enqueue(
              new TextEncoder().encode(
                ": keepalive\n\n"
              )
            );
          }, 15_000);

        keepalive.unref?.();

        controller.enqueue(
          encodeSse(
            "ready",
            {
              connected: true
            }
          )
        );

        request.signal.addEventListener(
          "abort",
          cleanup,
          { once: true }
        );
      }
    });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type":
        "text/event-stream; charset=utf-8",
      "cache-control":
        "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    }
  });
}
