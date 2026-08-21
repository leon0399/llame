// @vitest-environment jsdom

import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const updateMemoryEndpoint = vi.hoisted(() => vi.fn());
const authenticatedFetch = vi.hoisted(() => vi.fn());
const createAuthenticatedBrowserFetch = vi.hoisted(() => vi.fn());

vi.mock("../../api/generated/memory/memory", () => ({
  updateMemory: updateMemoryEndpoint,
}));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch,
}));

import {
  memoryMutationKeys,
  updateMemory,
  useUpdateMemoryMutation,
} from "./mutations";
import { memoryQueryKeys } from "./queries";
import type { MemoryResponse } from "../../api/generated/models";

createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);

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

afterEach(() => {
  vi.clearAllMocks();
  createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);
});

describe("memory mutation transport", () => {
  it("PATCHes the caller's memory through the generated authenticated endpoint", async () => {
    const input = { shareRecentChats: true };
    const response = { shareRecentChats: true };
    updateMemoryEndpoint.mockResolvedValue(response);

    await expect(updateMemory(input)).resolves.toEqual(response);

    expect(updateMemoryEndpoint).toHaveBeenCalledWith(
      input,
      undefined,
      authenticatedFetch,
    );
    expect(createAuthenticatedBrowserFetch).toHaveBeenCalledWith(
      globalThis.fetch,
    );
  });
});

describe("useUpdateMemoryMutation cache behavior", () => {
  it("cancels, snapshots, patches optimistically, and serializes memory updates", async () => {
    updateMemoryEndpoint.mockReturnValue(new Promise(() => {}));
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
    const error = new Error("network down");
    updateMemoryEndpoint.mockRejectedValue(error);
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
    updateMemoryEndpoint.mockResolvedValue({ shareRecentChats: true });
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
