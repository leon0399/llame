import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import type { RunUpdatedMessage } from "@/lib/api/live-generated/live-protocol";
import { pinQueryKeys } from "@/lib/services/pins/queries";
import type {
  RunMessage,
  RunProgressMessage,
} from "@/lib/services/live/live-messages";

import { addTrackedRun, nextRunPhases } from "./active-runs-context";
import { dispatchLiveMessage } from "./live-updates-context";

const chatId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

const progress = (phase: RunProgressMessage["phase"]): RunProgressMessage => ({
  type: "run.progress",
  runId,
  chatId,
  phase,
  step: 1,
});

const updated = (
  status: RunUpdatedMessage["run"]["status"],
): RunUpdatedMessage => ({
  type: "run.updated",
  run: {
    id: runId,
    chatId,
    messageId: null,
    modelId: "m",
    permissionMode: "default",
    status,
    error: null,
    createdAt: "2026-10-16T12:00:00.000Z",
    startedAt: null,
    finishedAt: null,
  },
});

describe("dispatchLiveMessage", () => {
  it("routes run messages to subscribers and records to the caches", () => {
    const client = new QueryClient();
    const received: Array<RunMessage> = [];
    const listeners = new Set([(m: RunMessage) => received.push(m)]);

    dispatchLiveMessage(progress("tool"), client, listeners);
    dispatchLiveMessage(updated("completed"), client, listeners);
    dispatchLiveMessage(
      { type: "pins.replaced", items: [] },
      client,
      listeners,
    );
    dispatchLiveMessage(undefined, client, listeners);

    expect(received.map((m) => m.type)).toEqual([
      "run.progress",
      "run.updated",
    ]);
    expect(client.getQueryData(pinQueryKeys.list())).toEqual([]);
  });

  it("does not patch caches for run messages", () => {
    const client = new QueryClient();
    const setQueryData = vi.spyOn(client, "setQueryData");
    dispatchLiveMessage(progress("tool"), client, new Set());
    expect(setQueryData).not.toHaveBeenCalled();
  });
});

describe("nextRunPhases", () => {
  it("sets the phase from progress and clears it when the Run finishes", () => {
    const empty = new Map();
    const thinking = nextRunPhases(empty, progress("thinking"));
    expect(thinking.get(chatId)).toBe("thinking");
    expect(nextRunPhases(thinking, progress("thinking"))).toBe(thinking);
    const writing = nextRunPhases(thinking, progress("writing"));
    expect(writing.get(chatId)).toBe("writing");
    expect(nextRunPhases(writing, updated("running_model"))).toBe(writing);
    expect(nextRunPhases(writing, updated("completed")).has(chatId)).toBe(
      false,
    );
    expect(nextRunPhases(empty, updated("failed"))).toBe(empty);
  });
});

describe("addTrackedRun", () => {
  it("is idempotent for the same title and keeps a real title over the placeholder", () => {
    const tracked = addTrackedRun(new Map(), runId, chatId, "Real title");
    expect(addTrackedRun(tracked, runId, chatId, "Real title")).toBe(tracked);
    expect(addTrackedRun(tracked, runId, chatId, "Chat")).toBe(tracked);
  });

  it("replaces the placeholder a live message tracked the run under", () => {
    const live = addTrackedRun(new Map(), runId, chatId, "Chat");
    const own = addTrackedRun(live, runId, chatId, "Real title");
    expect(own.get(runId)).toEqual({ chatId, title: "Real title" });
  });
});
