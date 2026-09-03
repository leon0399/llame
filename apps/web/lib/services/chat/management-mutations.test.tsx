// @vitest-environment jsdom

/**
 * Mutation-hook-level coverage: a failed rename/delete must surface a
 * toast, not fail silently (found in review — the mutations only handled
 * onSuccess). Pin/unpin's own toast coverage lives in
 * ../pins/mutations.test.ts (rework-item-pinning) — pinning is no longer
 * part of this module.
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

import {
  useDeleteChat,
  useRenameChat,
  useSetChatArchive,
  useSetChatVisibility,
} from "./management";
import { chatQueryKeys } from "./queries";
import { pinQueryKeys } from "../pins/queries";
import { emptyResponse, stubFetch } from "../../test-support/fetch-stub";
import {
  newTestQueryClient,
  wrapperWithClient,
} from "../../test-support/query-client";

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

  it("invalidates the chat list and pins list on success", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    const queryClient = newTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteChat(), {
      wrapper: wrapperWithClient(queryClient),
    });

    result.current.mutate("c1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: chatQueryKeys.lists(),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: pinQueryKeys.list(),
    });
  });
});

describe("useRenameChat: success invalidation", () => {
  it("invalidates the chat list, that chat's own detail, and pins list", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    const queryClient = newTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRenameChat(), {
      wrapper: wrapperWithClient(queryClient),
    });

    result.current.mutate({ id: "c1", title: "New title" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: chatQueryKeys.lists(),
    });
    // exact: true — a rename must not wipe the chat's own message history,
    // only its own detail entry.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: chatQueryKeys.detail("c1"),
      exact: true,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: pinQueryKeys.list(),
    });
  });
});

describe("useSetChatArchive", () => {
  it("invalidates the chat list and pins list on success", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    const queryClient = newTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSetChatArchive(), {
      wrapper: wrapperWithClient(queryClient),
    });

    result.current.mutate({ id: "c1", archived: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: chatQueryKeys.lists(),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: pinQueryKeys.list(),
    });
  });

  it("toasts an archive-specific message on failure", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { result } = renderHook(() => useSetChatArchive(), { wrapper });

    result.current.mutate({ id: "c1", archived: true });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorSpy).toHaveBeenCalledWith("Couldn't archive the chat.");
  });

  it("toasts an unarchive-specific message on failure", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { result } = renderHook(() => useSetChatArchive(), { wrapper });

    result.current.mutate({ id: "c1", archived: false });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorSpy).toHaveBeenCalledWith("Couldn't unarchive the chat.");
  });
});

describe("useSetChatVisibility", () => {
  it("invalidates the chat list on success", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    const queryClient = newTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSetChatVisibility(), {
      wrapper: wrapperWithClient(queryClient),
    });

    result.current.mutate({ id: "c1", visibility: "public" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: chatQueryKeys.lists(),
    });
  });

  it("toasts on failure instead of failing silently", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { result } = renderHook(() => useSetChatVisibility(), { wrapper });

    result.current.mutate({ id: "c1", visibility: "public" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorSpy).toHaveBeenCalledWith(
      "Couldn't update sharing for this chat.",
    );
  });
});
