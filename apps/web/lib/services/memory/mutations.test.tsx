// @vitest-environment jsdom

import * as React from "react";
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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  memoryMutationKeys,
  updateMemory,
  useUpdateMemoryMutation,
} from "./mutations";
import { memoryQueryKeys } from "./queries";
import type { MemoryResponse } from "../../api/generated/models";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";

const initial: MemoryResponse = { shareRecentChats: false };

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("memory mutation transport", () => {
  it("PATCHes the caller's memory through the generated authenticated endpoint", async () => {
    const input = { shareRecentChats: true };
    fetchMock.mockResolvedValue(jsonResponse(input));

    await expect(updateMemory(input)).resolves.toEqual(input);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/me/memory");
    await expect(request.clone().json()).resolves.toEqual(input);
  });
});

describe("useUpdateMemoryMutation cache behavior", () => {
  it("cancels, snapshots, patches optimistically, and serializes memory updates", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    const queryClient = createQueryClient();
    const cancelQueries = vi.spyOn(queryClient, "cancelQueries");
    queryClient.setQueryData(memoryQueryKeys.mine(), initial);

    const { result } = renderHook(() => useUpdateMemoryMutation(), {
      wrapper: wrapper(queryClient),
    });
    result.current.mutate({ shareRecentChats: true });

    await waitFor(() => {
      expect(queryClient.getQueryData(memoryQueryKeys.mine())).toEqual({
        shareRecentChats: true,
      });
    });

    expect(cancelQueries).toHaveBeenCalledWith({
      queryKey: memoryQueryKeys.mine(),
    });
    expect(queryClient.getMutationCache().getAll()[0]?.options.scope).toEqual({
      id: "memory",
    });
    expect(memoryMutationKeys.update()).toEqual([
      "memory",
      "mutations",
      "update",
    ]);
  });

  it("rolls back the snapshot and invalidates after a failed update", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const queryClient = createQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    queryClient.setQueryData(memoryQueryKeys.mine(), initial);

    const { result } = renderHook(() => useUpdateMemoryMutation(), {
      wrapper: wrapper(queryClient),
    });
    result.current.mutate({ shareRecentChats: true });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData(memoryQueryKeys.mine())).toEqual(initial);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: memoryQueryKeys.mine(),
    });
  });

  it("invalidates after a successful update", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ shareRecentChats: true }));
    const queryClient = createQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateMemoryMutation(), {
      wrapper: wrapper(queryClient),
    });
    result.current.mutate({ shareRecentChats: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: memoryQueryKeys.mine(),
    });
  });
});
