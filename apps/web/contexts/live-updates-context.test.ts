import { describe, expect, it } from "vitest";

import { activeRunsQueryKeys } from "@/lib/services/chat/active-runs";
import { chatQueryKeys } from "@/lib/services/chat/queries";
import type { RunProgressMessage } from "@/lib/services/live/live-messages";
import { pinQueryKeys } from "@/lib/services/pins/queries";
import { projectQueryKeys } from "@/lib/services/project/queries";

import { nextRunPhases } from "./active-runs-context";
import { invalidationsFor } from "./live-updates-context";

const chatId = "chat-1";

describe("invalidationsFor", () => {
  it("invalidates the chat lists and that chat's detail on a chat change", () => {
    expect(
      invalidationsFor({ type: "chat.changed", chatId, change: "created" }),
    ).toEqual([
      { queryKey: chatQueryKeys.lists(), exact: false },
      { queryKey: chatQueryKeys.detail(chatId), exact: true },
    ]);
  });

  it("invalidates projects and chat lists on a project change, pins on a pin change", () => {
    expect(
      invalidationsFor({
        type: "project.changed",
        projectId: "p",
        change: "updated",
      }),
    ).toEqual([
      { queryKey: projectQueryKeys.lists(), exact: false },
      { queryKey: chatQueryKeys.lists(), exact: false },
    ]);
    expect(invalidationsFor({ type: "pin.changed", itemId: "x" })).toEqual([
      { queryKey: pinQueryKeys.list(), exact: false },
    ]);
  });

  it("invalidates every owner list on resync and nothing for run progress", () => {
    expect(invalidationsFor({ type: "resync" })).toEqual(
      [
        chatQueryKeys.lists(),
        pinQueryKeys.list(),
        projectQueryKeys.lists(),
        activeRunsQueryKeys.all,
      ].map((queryKey) => ({ queryKey, exact: false })),
    );
    expect(
      invalidationsFor({
        type: "run.progress",
        runId: "r",
        chatId,
        status: "running_model",
        phase: "tool",
        step: 1,
      }),
    ).toEqual([]);
  });
});

describe("nextRunPhases", () => {
  const progress = (
    status: RunProgressMessage["status"],
    phase: RunProgressMessage["phase"],
  ): RunProgressMessage => ({
    type: "run.progress",
    runId: "r",
    chatId,
    status,
    phase,
    step: 1,
  });

  it("sets the phase while in flight and clears it at a terminal status", () => {
    const empty = new Map();
    const thinking = nextRunPhases(
      empty,
      progress("running_model", "thinking"),
    );
    expect(thinking.get(chatId)).toBe("thinking");
    expect(nextRunPhases(thinking, progress("running_model", "thinking"))).toBe(
      thinking,
    );
    const writing = nextRunPhases(
      thinking,
      progress("running_model", "writing"),
    );
    expect(writing.get(chatId)).toBe("writing");
    expect(
      nextRunPhases(writing, progress("completed", "finished")).has(chatId),
    ).toBe(false);
    expect(nextRunPhases(empty, progress("failed", "finished"))).toBe(empty);
  });
});
