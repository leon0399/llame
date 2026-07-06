// @vitest-environment jsdom

/** useForkChat hook coverage: a failed fork must toast, not fail silently. */

import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("../../api/client", () => ({
  api: { post },
  buildApiUrl: (path: string) => `http://api${path}`,
}));
vi.mock("@workspace/ui/components/sonner", () => ({
  toast: { error: toastError },
}));

import { useForkChat } from "./fork";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  post.mockReset();
  toastError.mockReset();
});

describe("useForkChat", () => {
  it("toasts on failure instead of failing silently", async () => {
    post.mockReturnValue({
      json: () => Promise.reject(new Error("network down")),
    });
    const { result } = renderHook(() => useForkChat(), { wrapper });

    result.current.mutate({ chatId: "chat-1", fromMessageId: "msg-1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't fork the chat. Nothing was created.",
    );
  });
});
