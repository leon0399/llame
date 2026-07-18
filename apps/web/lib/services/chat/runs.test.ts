import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factories (also hoisted) can close over them.
const { get, patch, FakeHTTPError } = vi.hoisted(() => {
  // Minimal stand-in for ky's HTTPError (instanceof + .response.status).
  class FakeHTTPError extends Error {
    response: { status: number };
    constructor(status: number) {
      super(`HTTP ${status}`);
      this.response = { status };
    }
  }
  return { get: vi.fn(), patch: vi.fn(), FakeHTTPError };
});

vi.mock("../../api/client", () => ({
  api: { get, patch },
  buildApiUrl: (path: string) => `http://api${path}`,
}));
vi.mock("ky", () => ({ HTTPError: FakeHTTPError }));

import {
  cancelRun,
  fetchRunContextReceipt,
  runIdToCancel,
  runQueryKeys,
} from "./runs";

afterEach(() => {
  patch.mockReset();
  get.mockReset();
});

describe("fetchRunContextReceipt", () => {
  it("loads an owner receipt only when the receipt query is invoked", async () => {
    const receipt = {
      modelId: "system:openai:gpt-5.4-mini",
      promptSource: "project_default",
      systemPrompt: "You are llame.",
      tools: [],
      contentHash: "sha256:receipt",
      createdAt: "2026-07-18T00:00:00.000Z",
    };
    const json = vi.fn().mockResolvedValue(receipt);
    get.mockReturnValue({ json });

    await expect(
      fetchRunContextReceipt({
        queryKey: runQueryKeys.contextReceipt("run/with spaces"),
        signal: new AbortController().signal,
        meta: undefined,
        pageParam: undefined,
        direction: undefined,
        client: undefined as never,
      }),
    ).resolves.toEqual(receipt);

    expect(get).toHaveBeenCalledWith(
      "http://api/api/v1/runs/run%2Fwith%20spaces/context-receipt",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
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
