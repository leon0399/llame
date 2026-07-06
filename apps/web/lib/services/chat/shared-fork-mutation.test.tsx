// @vitest-environment jsdom

/**
 * useForkSharedChat hook coverage: a failed fork must toast, not fail
 * silently, and a SUCCESSFUL fork must invalidate the chat list so the new
 * chat appears in the caller's own sidebar without a manual refresh (same
 * invalidation useForkChat does for the owner-scoped fork).
 */

import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("../../api/client", () => ({
  api: { post: (...a: unknown[]) => ({ json: () => post(...a) }) },
  buildApiUrl: (path: string) => `http://api${path}`,
}));
vi.mock("@workspace/ui/components/sonner", () => ({
  toast: { error: toastError },
}));

import { chatQueryKeys } from "./queries";
import { useForkSharedChat } from "./shared";

function makeWrapper(queryClient: QueryClient) {
  return function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

afterEach(() => {
  post.mockReset();
  toastError.mockReset();
});

describe("useForkSharedChat", () => {
  it("toasts on failure instead of failing silently", async () => {
    post.mockRejectedValue(new Error("network down"));
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
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't fork this chat. Nothing was created.",
    );
  });

  it("invalidates the chat list on success, so the new chat appears without a refresh", async () => {
    post.mockResolvedValue({ id: "new-chat" });
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
