import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factories (also hoisted) can close over them.
const { get, FakeHTTPError } = vi.hoisted(() => {
  // Minimal stand-in for ky's HTTPError (instanceof + .response.status).
  class FakeHTTPError extends Error {
    response: { status: number };
    constructor(status: number) {
      super(`HTTP ${status}`);
      this.response = { status };
    }
  }
  return { get: vi.fn(), FakeHTTPError };
});

vi.mock("../../api/client", () => ({
  api: { get: (...a: unknown[]) => ({ json: () => get(...a) }) },
  buildApiUrl: (path: string) => `http://api${path}`,
}));
vi.mock("ky", () => ({ HTTPError: FakeHTTPError }));

import { fetchRun } from "./active-runs";

afterEach(() => {
  get.mockReset();
});

describe("fetchRun", () => {
  it("GETs the run and returns it", async () => {
    get.mockResolvedValue({ id: "run-1", status: "running_model" });
    const run = await fetchRun("run-1");
    expect(get).toHaveBeenCalledWith("http://api/api/v1/runs/run-1");
    expect(run).toEqual({ id: "run-1", status: "running_model" });
  });

  it("returns null on 404 (run gone — e.g. chat deleted)", async () => {
    get.mockRejectedValue(new FakeHTTPError(404));
    await expect(fetchRun("gone")).resolves.toBeNull();
  });

  it("propagates non-404 errors", async () => {
    get.mockRejectedValue(new FakeHTTPError(500));
    await expect(fetchRun("run-x")).rejects.toBeInstanceOf(FakeHTTPError);
  });
});
