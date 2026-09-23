import { GatewayClient } from "@openclaw/gateway-client";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES
} from "@openclaw/gateway-protocol/client-info";

export const SKRIVEBORD_OPENCLAW_SCOPES = [
  "operator.read",
  "operator.write"
] as const;

export type OpenClawGatewayStatus =
  | {
      status: "READY";
      protocolVersion?: number;
    }
  | {
      status:
        | "CONNECTING"
        | "UNAVAILABLE"
        | "MISCONFIGURED";
      reason?: string;
    };

export type OpenClawChatAccepted = {
  runId: string;
  sessionKey: string;
  status:
    | "accepted"
    | "started"
    | "queued"
    | string;
  messageSeq?: number;
  attemptId?: string;
};

export type OpenClawWaitResult = {
  runId: string;
  status:
    | "ok"
    | "error"
    | "timeout"
    | "pending"
    | string;
  terminalReply?: unknown;
  terminalReceipt?: unknown;
  error?: unknown;
  stopReason?: string;
  startedAt?: number;
  endedAt?: number;
};

export type OpenClawHistoryResult = {
  messages?: unknown[];
  inFlightRun?: {
    runId?: string;
    text?: string;
    plan?: unknown;
  };
  sessionInfo?: {
    hasActiveRun?: boolean;
    activeRunIds?: string[];
  };
  deltaCursor?: string;
  [key: string]: unknown;
};

export type OpenClawGatewayConfig = {
  url: string;
  token: string;
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
};

type GatewayHello = {
  protocol?: number;
  protocolVersion?: number;
  [key: string]: unknown;
};

function asRecord(
  value: unknown
): Record<string, unknown> | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string"
    ? value
    : undefined;
}

function readNumber(
  record: Record<string, unknown>,
  key: string
): number | undefined {
  const value = record[key];
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : undefined;
}

export function parseChatAccepted(
  value: unknown
): OpenClawChatAccepted {
  const record = asRecord(value);
  if (!record) {
    throw new Error(
      "OPENCLAW_CHAT_SEND_INVALID_RESPONSE"
    );
  }

  const runId = readString(
    record,
    "runId"
  );
  const sessionKey = readString(
    record,
    "sessionKey"
  );
  const status =
    readString(record, "status");

  if (
    !runId ||
    !sessionKey ||
    !status
  ) {
    throw new Error(
      "OPENCLAW_CHAT_SEND_INVALID_RESPONSE"
    );
  }

  return {
    runId,
    sessionKey,
    status,
    messageSeq:
      readNumber(
        record,
        "messageSeq"
      ),
    attemptId:
      readString(
        record,
        "attemptId"
      )
  };
}

export function parseWaitResult(
  value: unknown,
  fallbackRunId: string
): OpenClawWaitResult {
  const record = asRecord(value);
  if (!record) {
    throw new Error(
      "OPENCLAW_WAIT_INVALID_RESPONSE"
    );
  }

  const status =
    readString(record, "status");
  if (!status) {
    throw new Error(
      "OPENCLAW_WAIT_INVALID_RESPONSE"
    );
  }

  return {
    runId:
      readString(record, "runId") ??
      fallbackRunId,
    status,
    terminalReply:
      record.terminalReply,
    terminalReceipt:
      record.terminalReceipt,
    error: record.error,
    stopReason:
      readString(
        record,
        "stopReason"
      ),
    startedAt:
      readNumber(
        record,
        "startedAt"
      ),
    endedAt:
      readNumber(
        record,
        "endedAt"
      )
  };
}

export class OpenClawGatewayAdapter {
  private client:
    | GatewayClient
    | undefined;
  private ready = false;
  private hello:
    | GatewayHello
    | undefined;
  private connectPromise:
    | Promise<void>
    | undefined;
  private connectResolve:
    | (() => void)
    | undefined;
  private connectReject:
    | ((error: Error) => void)
    | undefined;

  constructor(
    private readonly config:
      OpenClawGatewayConfig
  ) {
    const url = new URL(
      config.url
    );

    if (
      url.protocol !== "ws:" &&
      url.protocol !== "wss:"
    ) {
      throw new Error(
        "OPENCLAW_GATEWAY_URL_MUST_BE_WS_OR_WSS"
      );
    }

    if (!config.token.trim()) {
      throw new Error(
        "OPENCLAW_GATEWAY_TOKEN_REQUIRED"
      );
    }
  }

  private buildClient(): GatewayClient {
    return new GatewayClient({
      url: this.config.url,
      token:
        this.config.token,
      clientName:
        GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientDisplayName:
        "Skrivebord",
      clientVersion:
        "0.1.0",
      mode:
        GATEWAY_CLIENT_MODES.BACKEND,
      role: "operator",
      scopes: [
        ...SKRIVEBORD_OPENCLAW_SCOPES
      ],
      caps: [],
      requestTimeoutMs:
        this.config
          .requestTimeoutMs ??
        30_000,
      onHelloOk: (hello) => {
        this.ready = true;
        this.hello =
          hello as GatewayHello;
        this.connectResolve?.();
        this.clearConnectDeferred();
      },
      onConnectError: (
        error
      ) => {
        this.ready = false;
        this.connectReject?.(
          error instanceof Error
            ? error
            : new Error(
                String(error)
              )
        );
        this.clearConnectDeferred();
      },
      onClose: () => {
        this.ready = false;
      }
    });
  }

  private clearConnectDeferred() {
    this.connectPromise =
      undefined;
    this.connectResolve =
      undefined;
    this.connectReject =
      undefined;
  }

  async connect(): Promise<void> {
    if (
      this.ready &&
      this.client?.connected
    ) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    if (!this.client) {
      this.client =
        this.buildClient();
    }

    this.connectPromise =
      new Promise<void>(
        (resolve, reject) => {
          this.connectResolve =
            resolve;
          this.connectReject =
            reject;
        }
      );

    this.client.start();

    const timeoutMs =
      this.config
        .connectTimeoutMs ??
      20_000;

    let timer:
      | ReturnType<
          typeof setTimeout
        >
      | undefined;

    try {
      await Promise.race([
        this.connectPromise,
        new Promise<never>(
          (_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "OPENCLAW_GATEWAY_CONNECT_TIMEOUT"
                  )
                ),
              timeoutMs
            );
            timer.unref?.();
          }
        )
      ]);
    } catch (error) {
      this.ready = false;
      this.clearConnectDeferred();
      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async stop(): Promise<void> {
    const client =
      this.client;

    this.client =
      undefined;
    this.ready = false;
    this.hello =
      undefined;
    this.clearConnectDeferred();

    if (client) {
      await client.stopAndWait({
        timeoutMs: 2_000
      });
    }
  }

  async status(): Promise<OpenClawGatewayStatus> {
    try {
      await this.connect();

      if (!this.client) {
        return {
          status: "UNAVAILABLE",
          reason:
            "Gateway client mangler."
        };
      }

      await this.client.request(
        "health",
        {}
      );

      return {
        status: "READY",
        protocolVersion:
          typeof this.hello
            ?.protocolVersion ===
          "number"
            ? this.hello
                .protocolVersion
            : typeof this.hello
                  ?.protocol ===
                "number"
              ? this.hello
                  .protocol
              : undefined
      };
    } catch (error) {
      return {
        status: "UNAVAILABLE",
        reason:
          error instanceof Error
            ? error.message
            : "OPENCLAW_GATEWAY_UNAVAILABLE"
      };
    }
  }

  private async request<T>(
    method: string,
    params: unknown,
    options?: {
      timeoutMs?: number;
    }
  ): Promise<T> {
    await this.connect();

    if (!this.client) {
      throw new Error(
        "OPENCLAW_GATEWAY_CLIENT_MISSING"
      );
    }

    return this.client.request<T>(
      method,
      params,
      options
    );
  }

  async sendChat(input: {
    sessionKey: string;
    agentId: string;
    message: string;
    idempotencyKey: string;
    queueMode?:
      | "steer"
      | "followup"
      | "collect"
      | "interrupt";
  }): Promise<OpenClawChatAccepted> {
    const message =
      input.message.trim();

    if (!message) {
      throw new Error(
        "OPENCLAW_CHAT_MESSAGE_REQUIRED"
      );
    }

    const response =
      await this.request<unknown>(
        "chat.send",
        {
          sessionKey:
            input.sessionKey,
          agentId:
            input.agentId,
          message,
          deliver: false,
          idempotencyKey:
            input.idempotencyKey,
          ...(input.queueMode
            ? {
                queueMode:
                  input.queueMode
              }
            : {})
        }
      );

    return parseChatAccepted(
      response
    );
  }

  async waitForRun(input: {
    runId: string;
    timeoutMs?: number;
  }): Promise<OpenClawWaitResult> {
    const timeoutMs =
      input.timeoutMs ??
      30_000;

    const response =
      await this.request<unknown>(
        "agent.wait",
        {
          runId:
            input.runId,
          timeoutMs
        },
        {
          timeoutMs:
            timeoutMs + 5_000
        }
      );

    return parseWaitResult(
      response,
      input.runId
    );
  }

  async history(input: {
    sessionKey: string;
    agentId: string;
    limit?: number;
  }): Promise<OpenClawHistoryResult> {
    return this.request<
      OpenClawHistoryResult
    >(
      "chat.history",
      {
        sessionKey:
          input.sessionKey,
        agentId:
          input.agentId,
        limit:
          Math.min(
            Math.max(
              input.limit ?? 50,
              1
            ),
            200
          )
      }
    );
  }
}
