import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import {
  activeRunsToTrackArgs,
  fetchActiveRuns,
  fetchRun,
  type ActiveRun,
} from "./active-runs";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";

// Real generated endpoints + the real authenticated-fetch policy run
// unmocked; only the actual network boundary (globalThis.fetch, the seam
// documented in lib/api/CLAUDE.md) is stubbed with a real Response.
let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRun", () => {
  it("GETs the run and returns it", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "run-1", status: "running_model" }),
    );

    const run = await fetchRun("run-1");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/api/v1/runs/run-1");
    expect(run).toEqual({ id: "run-1", status: "running_model" });
  });

  it("returns null on 404 (run gone — e.g. chat deleted)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "gone" }, 404));
    await expect(fetchRun("gone")).resolves.toBeNull();
  });

  it("propagates non-404 errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "down" }, 500));
    await expect(fetchRun("run-x")).rejects.toMatchObject({
      status: 500,
      info: { message: "down" },
    });
  });

  it("uses the generated me binding for active runs", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        {
          runId: "run-1",
          chatId: "chat-1",
          chatTitle: "Chat",
          status: "running_model",
          createdAt: "2026-07-03T00:00:00.000Z",
        },
      ]),
    );

    await expect(fetchActiveRuns()).resolves.toHaveLength(1);
    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    expect(
      `${new URL(request.url).pathname}${new URL(request.url).search}`,
    ).toBe("/api/v1/me/runs?status=active");
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
