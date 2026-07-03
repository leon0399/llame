import { describe, expect, it } from "vitest";

import { activeRunsToTrackArgs, type ActiveRun } from "./active-runs";

const run = (runId: string, chatId: string, chatTitle: string): ActiveRun => ({
  runId,
  chatId,
  chatTitle,
  status: "running_model",
  createdAt: "2026-07-03T00:00:00.000Z",
});

describe("activeRunsToTrackArgs", () => {
  it("maps each active run to trackRun(runId, chatId, title) args", () => {
    expect(
      activeRunsToTrackArgs([
        run("r1", "c1", "First"),
        run("r2", "c2", "Second"),
      ]),
    ).toEqual([
      ["r1", "c1", "First"],
      ["r2", "c2", "Second"],
    ]);
  });

  it("maps an empty set to no args", () => {
    expect(activeRunsToTrackArgs([])).toEqual([]);
  });
});
