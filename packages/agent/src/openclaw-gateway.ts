import {
  GatewayClient,
  type GatewayClientOptions
} from "@openclaw/gateway-client";
import {
  PROTOCOL_VERSION
} from "@openclaw/gateway-protocol/version";

export const OPENCLAW_GATEWAY_PACKAGE_VERSION =
  "2026.8.1" as const;

export const OPENCLAW_OPERATOR_SCOPES = [
  "operator.read",
  "operator.write"
] as const;

export type OpenClawGatewayConfig = {
  url: string;
  token: string;
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
};

export type OpenClawGatewayEvent = {
  event: string;
  payload?: unknown;
  seq?: number;
};

export type OpenClawGatewayHealth = {
  connected: true;
  protocol: number;
  uptimeMs?: number;
};

export type OpenClawChatSendResult = {
  runId: string;
  accepted: unknown;
  final: unknown;
};

export type OpenClawChatSendInput = {
  sessionKey: string;
  message: string;
  idempotencyKey: string;
  timeoutMs?: number;
  onEvent?: (
    event: OpenClawGatewayEvent
  ) => void;
  onAccepted?: (
    payload: unknown
  ) => void;
};

export type OpenClawHistoryInput = {
  sessionKey: string;
  limit?: number;
};

type GatewayClientLike = Pick<
  GatewayClient,
  | "start"
  | "stopAndWait"
  | "request"
  | "connected"
>;

type GatewayClientFactory = (
  options: GatewayClientOptions
) => GatewayClientLike;

function ensureGatewayUrl(
  rawUrl: string
): string {
  const url = new URL(rawUrl);

  if (url.protocol === "wss:") {
    return url.toString();
  }

  const loopback =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";

  if (
    url.protocol === "ws:" &&
    loopback
  ) {
    return url.toString();
  }

  throw new Error(
    "OPENCLAW_GATEWAY_REQUIRES_WSS_OR_LOOPBACK_WS"
  );
}

function readRunId(
  value: unknown
): string | undefined {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return undefined;
  }

  const runId = (
    value as {
      runId?: unknown;
    }
  ).runId;

  return typeof runId === "string" &&
    runId.length > 0
    ? runId
    : undefined;
}

function helloProtocol(
  value: unknown
): number {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return PROTOCOL_VERSION;
  }

  const protocol = (
    value as {
      protocol?: unknown;
    }
  ).protocol;

  return typeof protocol === "number"
    ? protocol
    : PROTOCOL_VERSION;
}

function helloUptime(
  value: unknown
): number | undefined {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return undefined;
  }

  const snapshot = (
    value as {
      snapshot?: unknown;
    }
  ).snapshot;

  if (
    typeof snapshot !== "object" ||
    snapshot === null
  ) {
    return undefined;
  }

  const uptimeMs = (
    snapshot as {
      uptimeMs?: unknown;
    }
  ).uptimeMs;

  return typeof uptimeMs === "number"
    ? uptimeMs
    : undefined;
}

export class OpenClawGatewayAdapter {
  private readonly url: string;
  private readonly requestTimeoutMs: number;
  private readonly connectTimeoutMs: number;

  constructor(
    private readonly config:
      OpenClawGatewayConfig,
    private readonly factory:
      GatewayClientFactory = (
        options
      ) => new GatewayClient(options)
  ) {
    if (!config.token.trim()) {
      throw new Error(
        "OPENCLAW_GATEWAY_TOKEN_REQUIRED"
      );
    }

    this.url = ensureGatewayUrl(
      config.url
    );
    this.requestTimeoutMs =
      config.requestTimeoutMs ??
      120_000;
    this.connectTimeoutMs =
      config.connectTimeoutMs ??
      8_000;

    if (PROTOCOL_VERSION !== 4) {
      throw new Error(
        `OPENCLAW_PROTOCOL_VERSION_UNEXPECTED:${PROTOCOL_VERSION}`
      );
    }
  }

  async health(): Promise<
    OpenClawGatewayHealth
  > {
    const { client, hello } =
      await this.connect();

    try {
      return {
        connected: true,
        protocol:
          helloProtocol(hello),
        uptimeMs:
          helloUptime(hello)
      };
    } finally {
      await client.stopAndWait();
    }
  }

  async sendChat(
    input: OpenClawChatSendInput
  ): Promise<OpenClawChatSendResult> {
    if (!input.message.trim()) {
      throw new Error(
        "OPENCLAW_CHAT_MESSAGE_REQUIRED"
      );
    }

    const { client } =
      await this.connect(
        input.onEvent
      );

    let accepted: unknown;

    try {
      const final =
        await client.request<unknown>(
          "chat.send",
          {
            sessionKey:
              input.sessionKey,
            message:
              input.message,
            deliver: false,
            idempotencyKey:
              input.idempotencyKey
          },
          {
            expectFinal: true,
            timeoutMs:
              input.timeoutMs ??
              this.requestTimeoutMs,
            onAccepted: (
              payload
            ) => {
              accepted = payload;
              input.onAccepted?.(
                payload
              );
            }
          }
        );

      return {
        runId:
          readRunId(accepted) ??
          readRunId(final) ??
          input.idempotencyKey,
        accepted,
        final
      };
    } finally {
      await client.stopAndWait();
    }
  }

  async history(
    input: OpenClawHistoryInput
  ): Promise<unknown> {
    const { client } =
      await this.connect();

    try {
      return await client.request(
        "chat.history",
        {
          sessionKey:
            input.sessionKey,
          limit: Math.min(
            Math.max(
              input.limit ?? 50,
              1
            ),
            100
          )
        },
        {
          timeoutMs:
            this.requestTimeoutMs
        }
      );
    } finally {
      await client.stopAndWait();
    }
  }

  private connect(
    onEvent?: (
      event: OpenClawGatewayEvent
    ) => void
  ): Promise<{
    client: GatewayClientLike;
    hello: unknown;
  }> {
    return new Promise(
      (resolve, reject) => {
        let settled = false;
        let client:
          | GatewayClientLike
          | undefined;

        const timeout =
          setTimeout(() => {
            if (settled) return;
            settled = true;
            client?.stop();
            reject(
              new Error(
                "OPENCLAW_GATEWAY_CONNECT_TIMEOUT"
              )
            );
          }, this.connectTimeoutMs);

        timeout.unref?.();

        const finishReject = (
          error: Error
        ) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          client?.stop();
          reject(error);
        };

        client = this.factory({
          url: this.url,
          token:
            this.config.token,
          deviceIdentity: null,
          role: "operator",
          scopes: [
            ...OPENCLAW_OPERATOR_SCOPES
          ],
          minProtocol: 4,
          maxProtocol: 4,
          requestTimeoutMs:
            this.requestTimeoutMs,
          clientDisplayName:
            "Skrivebord",
          clientVersion:
            OPENCLAW_GATEWAY_PACKAGE_VERSION,
          onEvent: (event) => {
            onEvent?.({
              event: event.event,
              payload:
                event.payload,
              seq: event.seq
            });
          },
          onHelloOk: (
            hello
          ) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve({
              client: client!,
              hello
            });
          },
          onConnectError:
            finishReject,
          onReconnectPaused:
            (info) => {
              finishReject(
                new Error(
                  `OPENCLAW_GATEWAY_RECONNECT_PAUSED:${info.detailCode ?? info.reason}`
                )
              );
            }
        });

        client.start();
      }
    );
  }
}
