// @vitest-environment jsdom

/**
 * Mutation-hook-level coverage: a failed rename/pin/delete must surface a
 * toast, not fail silently (found in review — the mutations only handled
 * onSuccess).
 */

import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { patch, del } = vi.hoisted(() => ({ patch: vi.fn(), del: vi.fn() }));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("../../api/client", () => ({
  api: { patch, delete: del },
  buildApiUrl: (path: string) => `http://api${path}`,
}));
vi.mock("@workspace/ui/components/sonner", () => ({
  toast: { error: toastError },
}));

import {
  useDeleteChat,
  useRenameChat,
  useSetChatPinned,
} from "./management";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  patch.mockReset();
  del.mockReset();
  toastError.mockReset();
});

describe("useRenameChat", () => {
  it("toasts on failure instead of failing silently", async () => {
    patch.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useRenameChat(), { wrapper });

    result.current.mutate({ id: "c1", title: "New title" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith("Couldn't rename the chat.");
  });
});

describe("useSetChatPinned", () => {
  it("toasts a pin-specific message on failure", async () => {
    patch.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useSetChatPinned(), { wrapper });

    result.current.mutate({ id: "c1", pinned: true });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith("Couldn't pin the chat.");
  });

  it("toasts an unpin-specific message on failure", async () => {
    patch.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useSetChatPinned(), { wrapper });

    result.current.mutate({ id: "c1", pinned: false });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith("Couldn't unpin the chat.");
  });
});

describe("useDeleteChat", () => {
  it("toasts on failure instead of failing silently", async () => {
    del.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useDeleteChat(), { wrapper });

    result.current.mutate("c1");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith("Couldn't delete the chat.");
  });
});
