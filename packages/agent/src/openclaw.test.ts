import { describe, expect, it } from "vitest";
import {
  latestAssistantText,
  normalizeOpenClawHistory,
  parseChatAccepted,
  parseWaitResult
} from "./openclaw";

describe("OpenClaw Gateway adapter contracts", () => {
  it("parses accepted chat sends", () => {
    expect(
      parseChatAccepted({
        runId: "run-1",
        sessionKey: "agent:mojn:skrivebord:test:general",
        status: "accepted",
        messageSeq: 7
      })
    ).toEqual({
      runId: "run-1",
      sessionKey: "agent:mojn:skrivebord:test:general",
      status: "accepted",
      messageSeq: 7,
      attemptId: undefined
    });
  });

  it("keeps wait timeout non-terminal at the protocol layer", () => {
    expect(
      parseWaitResult(
        {
          status: "timeout"
        },
        "run-1"
      )
    ).toEqual({
      runId: "run-1",
      status: "timeout",
      terminalReply: undefined,
      terminalReceipt: undefined,
      error: undefined,
      stopReason: undefined,
      startedAt: undefined,
      endedAt: undefined
    });
  });

  it("normalizes only visible transcript text", () => {
    const messages =
      normalizeOpenClawHistory({
        messages: [
          {
            id: "u1",
            role: "user",
            content: "Hej"
          },
          {
            id: "a1",
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Hej fra Mojn"
              },
              {
                type: "tool_call",
                name: "ignored"
              }
            ]
          }
        ]
      });

    expect(messages).toEqual([
      {
        id: "u1",
        role: "user",
        text: "Hej",
        timestamp: undefined
      },
      {
        id: "a1",
        role: "assistant",
        text: "Hej fra Mojn",
        timestamp: undefined
      }
    ]);

    expect(
      latestAssistantText({
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Svar"
              }
            ]
          }
        ]
      })
    ).toBe("Svar");
  });
});
