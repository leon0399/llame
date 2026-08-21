// @vitest-environment jsdom

/**
 * Mutation-hook-level coverage: a failed rename/delete must surface a
 * toast, not fail silently (found in review — the mutations only handled
 * onSuccess). Pin/unpin's own toast coverage lives in
 * ../pins/mutations.test.ts (rework-item-pinning) — pinning is no longer
 * part of this module.
 */

import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { updateChat, deleteChatEndpoint } = vi.hoisted(() => ({
  updateChat: vi.fn(),
  deleteChatEndpoint: vi.fn(),
}));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("../../api/generated/chats/chats", () => ({
  updateChat,
  deleteChat: deleteChatEndpoint,
}));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch: () => vi.fn(),
}));
vi.mock("@workspace/ui/components/sonner", () => ({
  toast: { error: toastError },
}));

import { useDeleteChat, useRenameChat } from "./management";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  updateChat.mockReset();
  deleteChatEndpoint.mockReset();
  toastError.mockReset();
});

describe("useRenameChat", () => {
  it("toasts on failure instead of failing silently", async () => {
    updateChat.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useRenameChat(), { wrapper });

    result.current.mutate({ id: "c1", title: "New title" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith("Couldn't rename the chat.");
  });
});

describe("useDeleteChat", () => {
  it("toasts on failure instead of failing silently", async () => {
    deleteChatEndpoint.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useDeleteChat(), { wrapper });

    result.current.mutate("c1");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith("Couldn't delete the chat.");
  });
});
