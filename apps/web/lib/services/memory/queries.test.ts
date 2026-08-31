// @vitest-environment jsdom

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { fetchMemory, memoryQueryKeys, useMemoryQuery } from "./queries";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";
import {
  newTestQueryClient,
  wrapperWithClient,
} from "../../test-support/query-client";

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("memory query keys", () => {
  it("keeps the resource-path keys", () => {
    expect(memoryQueryKeys.all).toEqual(["memory"]);
    expect(memoryQueryKeys.mine()).toEqual(["memory", "me"]);
  });
});

describe("memory query transport", () => {
  it("fetches the caller's memory through the generated authenticated endpoint", async () => {
    const response = { shareRecentChats: false };
    fetchMock.mockResolvedValue(jsonResponse(response));

    await expect(fetchMemory()).resolves.toEqual(response);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/api/v1/me/memory");
    expect(request.credentials).toBe("include");
  });

  it("surfaces the caller's memory under the memoryQueryKeys.mine() key", async () => {
    const response = { shareRecentChats: true };
    fetchMock.mockResolvedValue(jsonResponse(response));
    const queryClient = newTestQueryClient();

    const { result } = renderHook(() => useMemoryQuery(), {
      wrapper: wrapperWithClient(queryClient),
    });

    await waitFor(() => expect(result.current.data).toEqual(response));
    expect(queryClient.getQueryData(memoryQueryKeys.mine())).toEqual(response);
  });
});
