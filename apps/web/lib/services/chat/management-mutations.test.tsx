// @vitest-environment jsdom

/**
 * Mutation-hook-level coverage: a failed rename/delete must surface a
 * toast, not fail silently (found in review — the mutations only handled
 * onSuccess). Pin/unpin's own toast coverage lives in
 * ../pins/mutations.test.ts (rework-item-pinning) — pinning is no longer
 * part of this module.
 */

import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "@workspace/ui/components/sonner";

import { useDeleteChat, useRenameChat } from "./management";
import { stubFetch } from "../../test-support/fetch-stub";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useRenameChat", () => {
  it("toasts on failure instead of failing silently", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { result } = renderHook(() => useRenameChat(), { wrapper });

    result.current.mutate({ id: "c1", title: "New title" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorSpy).toHaveBeenCalledWith("Couldn't rename the chat.");
  });
});

describe("useDeleteChat", () => {
  it("toasts on failure instead of failing silently", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { result } = renderHook(() => useDeleteChat(), { wrapper });

    result.current.mutate("c1");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorSpy).toHaveBeenCalledWith("Couldn't delete the chat.");
  });
});
