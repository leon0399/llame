import { describe, expect, it } from "vitest";

import {
  liveUpdatesUrl,
  parseLiveMessage,
  reconnectDelayMs,
} from "./live-messages";

const chatId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

describe("parseLiveMessage", () => {
  it("parses each message type the server sends", () => {
    expect(
      parseLiveMessage(
        JSON.stringify({ type: "chat.changed", chatId, change: "updated" }),
      ),
    ).toEqual({ type: "chat.changed", chatId, change: "updated" });
    expect(
      parseLiveMessage(
        JSON.stringify({
          type: "run.progress",
          runId,
          chatId,
          status: "running_model",
          phase: "tool",
          step: 2,
        }),
      ),
    ).toEqual({
      type: "run.progress",
      runId,
      chatId,
      status: "running_model",
      phase: "tool",
      step: 2,
    });
    expect(parseLiveMessage(JSON.stringify({ type: "resync" }))).toEqual({
      type: "resync",
    });
  });

  it.each([
    ["a binary frame", new ArrayBuffer(4)],
    ["malformed JSON", "{"],
    ["an unknown type", JSON.stringify({ type: "user.changed" })],
    [
      "an unknown run status",
      JSON.stringify({
        type: "run.progress",
        runId,
        chatId,
        status: "exploded",
        phase: "tool",
        step: 0,
      }),
    ],
    [
      "a missing field",
      JSON.stringify({ type: "chat.changed", change: "updated" }),
    ],
  ])("ignores %s", (_label, data) => {
    expect(parseLiveMessage(data)).toBeUndefined();
  });
});

describe("liveUpdatesUrl", () => {
  it("maps the API origin to the matching WebSocket scheme", () => {
    expect(liveUpdatesUrl("http://localhost:3001")).toBe(
      "ws://localhost:3001/api/v1/live",
    );
    expect(liveUpdatesUrl("https://api.example.com")).toBe(
      "wss://api.example.com/api/v1/live",
    );
  });
});

describe("reconnectDelayMs", () => {
  it("backs off exponentially within a jittered half-to-full window, capped at 30 s", () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(500);
    expect(reconnectDelayMs(0, () => 1)).toBe(1000);
    expect(reconnectDelayMs(3, () => 1)).toBe(8000);
    expect(reconnectDelayMs(20, () => 1)).toBe(30_000);
    expect(reconnectDelayMs(20, () => 0)).toBe(15_000);
  });
});
