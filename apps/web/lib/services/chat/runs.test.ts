import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { QueryClient } from "@tanstack/react-query";

import {
  cancelRun,
  fetchRunContextReceipt,
  runIdToCancel,
  runQueryKeys,
} from "./runs";
import {
  emptyResponse,
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    fetchMock.mockResolvedValue(jsonResponse(receipt));

    await expect(
      fetchRunContextReceipt({
        queryKey: runQueryKeys.contextReceipt("run/with spaces"),
        signal: new AbortController().signal,
        meta: undefined,
        pageParam: undefined,
        direction: undefined,
        client: new QueryClient(),
      }),
    ).resolves.toEqual(receipt);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe(
      "/api/v1/runs/run%2Fwith%20spaces/context-receipt",
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
    fetchMock.mockResolvedValue(emptyResponse());
    await cancelRun("run-1");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/runs/run-1");
    await expect(request.clone().json()).resolves.toEqual({
      status: "cancelled",
    });
  });

  it("swallows a 404 (run already gone) and a 409 (already terminal)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 404));
    await expect(cancelRun("run-x")).resolves.toBeUndefined();

    fetchMock.mockResolvedValueOnce(jsonResponse({}, 409));
    await expect(cancelRun("run-y")).resolves.toBeUndefined();
  });

  it("propagates other errors (e.g. 500, network)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(cancelRun("run-z")).rejects.toMatchObject({ status: 500 });

    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(cancelRun("run-w")).rejects.toThrow("network down");
  });
});
