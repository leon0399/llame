// @vitest-environment jsdom

/**
 * useForkSharedChat hook coverage: a failed fork must toast, not fail
 * silently, and a SUCCESSFUL fork must invalidate the chat list so the new
 * chat appears in the caller's own sidebar without a manual refresh (same
 * invalidation useForkChat does for the owner-scoped fork).
 */

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
import { toast } from "@workspace/ui/components/sonner";

import { chatQueryKeys } from "./queries";
import { useForkSharedChat } from "./shared";
import { jsonResponse, stubFetch } from "../../test-support/fetch-stub";

function makeWrapper(queryClient: QueryClient) {
  return function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useForkSharedChat", () => {
  it("toasts on failure instead of failing silently", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const { result } = renderHook(() => useForkSharedChat(), {
      wrapper: makeWrapper(queryClient),
    });

    result.current.mutate("shared-chat-1");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorSpy).toHaveBeenCalledWith(
      "Couldn't fork this chat. Nothing was created.",
    );
  });

  it("invalidates the chat list on success, so the new chat appears without a refresh", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "new-chat" }));
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useForkSharedChat(), {
      wrapper: makeWrapper(queryClient),
    });

    result.current.mutate("shared-chat-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: chatQueryKeys.lists(),
    });
  });
});
