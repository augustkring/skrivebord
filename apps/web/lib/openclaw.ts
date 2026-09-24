import {
  OpenClawGatewayAdapter
} from "@skrivebord/agent";

declare global {
  var __skrivebordOpenClawGateway:
    | OpenClawGatewayAdapter
    | undefined;
}

export function openClawRuntimeConfigured(): boolean {
  return Boolean(
    process.env
      .OPENCLAW_GATEWAY_URL &&
      process.env
        .OPENCLAW_GATEWAY_TOKEN
  );
}

export function getOpenClawGateway(): OpenClawGatewayAdapter {
  const url =
    process.env
      .OPENCLAW_GATEWAY_URL;
  const token =
    process.env
      .OPENCLAW_GATEWAY_TOKEN;

  if (!url || !token) {
    throw new Error(
      "OPENCLAW_RUNTIME_NOT_CONFIGURED"
    );
  }

  if (
    !globalThis
      .__skrivebordOpenClawGateway
  ) {
    globalThis
      .__skrivebordOpenClawGateway =
      new OpenClawGatewayAdapter({
        url,
        token,
        requestTimeoutMs: 30_000,
        connectTimeoutMs: 20_000
      });
  }

  return globalThis
    .__skrivebordOpenClawGateway;
}
