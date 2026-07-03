import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factories (also hoisted) can close over them.
const { patch, get, FakeHTTPError } = vi.hoisted(() => {
  // Minimal stand-in for ky's HTTPError (instanceof + .response.status).
  class FakeHTTPError extends Error {
    response: { status: number };
    constructor(status: number) {
      super(`HTTP ${status}`);
      this.response = { status };
    }
  }
  return { patch: vi.fn(), get: vi.fn(), FakeHTTPError };
});

vi.mock("../../api/client", () => ({
  api: { patch, get: (...a: unknown[]) => ({ json: () => get(...a) }) },
  buildApiUrl: (path: string) => `http://api${path}`,
}));
vi.mock("ky", () => ({ HTTPError: FakeHTTPError }));

import { cancelRun, fetchRun, runIdToCancel } from "./runs";

afterEach(() => {
  patch.mockReset();
  get.mockReset();
});

describe("runIdToCancel", () => {
  it("returns the last message id when it is the streaming assistant turn (id === run id)", () => {
    expect(
      runIdToCancel([
        { id: "u1", role: "user" },
        { id: "run-42", role: "assistant" },
      ]),
    ).toBe("run-42");
  });

  it("returns null in the submitted window (last message is the user turn)", () => {
    expect(
      runIdToCancel([
        { id: "a-prev", role: "assistant" },
        { id: "u2", role: "user" },
      ]),
    ).toBeNull();
  });

  it("returns null for an empty message list", () => {
    expect(runIdToCancel([])).toBeNull();
  });
});

describe("cancelRun", () => {
  it("PATCHes the run with status cancelled", async () => {
    patch.mockResolvedValue(undefined);
    await cancelRun("run-1");
    expect(patch).toHaveBeenCalledWith("http://api/api/v1/runs/run-1", {
      json: { status: "cancelled" },
    });
  });

  it("swallows a 404 (run already gone) and a 409 (already terminal)", async () => {
    patch.mockRejectedValueOnce(new FakeHTTPError(404));
    await expect(cancelRun("run-x")).resolves.toBeUndefined();

    patch.mockRejectedValueOnce(new FakeHTTPError(409));
    await expect(cancelRun("run-y")).resolves.toBeUndefined();
  });

  it("propagates other errors (e.g. 500, network)", async () => {
    patch.mockRejectedValueOnce(new FakeHTTPError(500));
    await expect(cancelRun("run-z")).rejects.toBeInstanceOf(FakeHTTPError);

    patch.mockRejectedValueOnce(new Error("network down"));
    await expect(cancelRun("run-w")).rejects.toThrow("network down");
  });
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
