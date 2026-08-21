import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factories (also hoisted) can close over them.
const { getRunContextReceipt, updateRun } = vi.hoisted(() => ({
  getRunContextReceipt: vi.fn(),
  updateRun: vi.fn(),
}));

vi.mock("../../api/generated/runs/runs", () => ({
  getRunContextReceipt,
  updateRun,
}));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch: () => vi.fn(),
}));

import {
  cancelRun,
  fetchRunContextReceipt,
  runIdToCancel,
  runQueryKeys,
} from "./runs";

afterEach(() => {
  updateRun.mockReset();
  getRunContextReceipt.mockReset();
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
    getRunContextReceipt.mockResolvedValue(receipt);

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

    expect(getRunContextReceipt).toHaveBeenCalledWith(
      "run%2Fwith%20spaces",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      expect.any(Function),
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
    updateRun.mockResolvedValue(undefined);
    await cancelRun("run-1");
    expect(updateRun).toHaveBeenCalledWith(
      "run-1",
      { status: "cancelled" },
      undefined,
      expect.any(Function),
    );
  });

  it("swallows a 404 (run already gone) and a 409 (already terminal)", async () => {
    updateRun.mockRejectedValueOnce({ status: 404, info: {} });
    await expect(cancelRun("run-x")).resolves.toBeUndefined();

    updateRun.mockRejectedValueOnce({ status: 409, info: {} });
    await expect(cancelRun("run-y")).resolves.toBeUndefined();
  });

  it("propagates other errors (e.g. 500, network)", async () => {
    const error = { status: 500, info: {} };
    updateRun.mockRejectedValueOnce(error);
    await expect(cancelRun("run-z")).rejects.toBe(error);

    updateRun.mockRejectedValueOnce(new Error("network down"));
    await expect(cancelRun("run-w")).rejects.toThrow("network down");
  });
});
