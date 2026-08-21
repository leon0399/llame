import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factories (also hoisted) can close over them.
const { getRun, listActiveRuns, fetchWithAuth } = vi.hoisted(() => ({
  getRun: vi.fn(),
  listActiveRuns: vi.fn(),
  fetchWithAuth: vi.fn(),
}));

vi.mock("../../api/generated/runs/runs", () => ({ getRun }));
vi.mock("../../api/generated/me/me", () => ({ listActiveRuns }));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch: () => fetchWithAuth,
}));

import { activeRunsToTrackArgs, fetchRun, type ActiveRun } from "./active-runs";

afterEach(() => {
  getRun.mockReset();
  listActiveRuns.mockReset();
});

describe("fetchRun", () => {
  it("GETs the run and returns it", async () => {
    getRun.mockResolvedValue({ id: "run-1", status: "running_model" });
    const run = await fetchRun("run-1");
    expect(getRun).toHaveBeenCalledWith(
      "run-1",
      undefined,
      expect.any(Function),
    );
    expect(run).toEqual({ id: "run-1", status: "running_model" });
  });

  it("returns null on 404 (run gone — e.g. chat deleted)", async () => {
    getRun.mockRejectedValue({ status: 404, info: { message: "gone" } });
    await expect(fetchRun("gone")).resolves.toBeNull();
  });

  it("propagates non-404 errors", async () => {
    const error = { status: 500, info: { message: "down" } };
    getRun.mockRejectedValue(error);
    await expect(fetchRun("run-x")).rejects.toBe(error);
  });

  it("uses the generated me binding for active runs", async () => {
    listActiveRuns.mockResolvedValue([
      {
        runId: "run-1",
        chatId: "chat-1",
        chatTitle: "Chat",
        status: "running_model",
        createdAt: "2026-07-03T00:00:00.000Z",
      },
    ]);

    await expect(
      (await import("./active-runs")).fetchActiveRuns(),
    ).resolves.toHaveLength(1);
    expect(listActiveRuns).toHaveBeenCalledWith(
      { status: "active" },
      undefined,
      expect.any(Function),
    );
  });
});

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

  it("falls back to the sidebar's own untitled-chat placeholder for a still-untitled chat", () => {
    expect(
      activeRunsToTrackArgs([
        { ...run("r1", "c1", "unused"), chatTitle: null },
      ]),
    ).toEqual([["r1", "c1", "New chat"]]);
  });
});
