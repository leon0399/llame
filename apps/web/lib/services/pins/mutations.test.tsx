// @vitest-environment jsdom

/**
 * Pin/unpin via the unified, idempotent PUT/DELETE /api/v1/pins/:itemType/:itemId
 * resource (design D2) — the plain HTTP functions, then hook-level coverage for
 * the optimistic card synthesis (design D5a) and the toast-on-failure behavior
 * (mirrors ../chat/management-mutations.test.tsx's convention).
 */

import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { put, del, FakeHTTPError } = vi.hoisted(() => {
  class FakeHTTPError extends Error {
    response: { status: number };
    constructor(status: number) {
      super(`HTTP ${status}`);
      this.response = { status };
    }
  }
  return { put: vi.fn(), del: vi.fn(), FakeHTTPError };
});
const toastError = vi.hoisted(() => vi.fn());

vi.mock("ky", () => ({ HTTPError: FakeHTTPError }));
vi.mock("../../api/client", () => ({
  api: { put, delete: del },
  buildApiUrl: (path: string) => `http://api${path}`,
}));
vi.mock("@workspace/ui/components/sonner", () => ({
  toast: { error: toastError },
}));

import { pinItem, unpinItem, usePinItem, useUnpinItem } from "./mutations";
import { pinQueryKeys } from "./queries";
import type { PinnedItem } from "./types";

function jsonResolved<T>(value: T) {
  return { json: () => Promise.resolve(value) };
}

afterEach(() => {
  put.mockReset();
  del.mockReset();
  toastError.mockReset();
});

describe("pinItem", () => {
  it("PUTs /pins/:itemType/:itemId with no body", async () => {
    put.mockReturnValue(
      jsonResolved({
        itemType: "chat",
        itemId: "c1",
        pinnedAt: "2026-01-01T00:00:00.000Z",
        item: { id: "c1", title: "Hi" },
      }),
    );
    await pinItem("chat", "c1");
    expect(put).toHaveBeenCalledWith("http://api/api/v1/pins/chat/c1");
  });
});

describe("unpinItem", () => {
  it("DELETEs /pins/:itemType/:itemId", async () => {
    del.mockResolvedValue(undefined);
    await unpinItem("project", "p1");
    expect(del).toHaveBeenCalledWith("http://api/api/v1/pins/project/p1");
  });

  it("swallows a 404 (already unpinned) as success", async () => {
    del.mockRejectedValue(new FakeHTTPError(404));
    await expect(unpinItem("chat", "gone")).resolves.toBeUndefined();
  });

  it("rethrows non-404 errors", async () => {
    del.mockRejectedValue(new FakeHTTPError(500));
    await expect(unpinItem("chat", "c1")).rejects.toBeInstanceOf(FakeHTTPError);
  });
});

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("usePinItem — optimistic card synthesis (design D5a)", () => {
  it("inserts the caller-supplied card into the pins cache before the server responds", async () => {
    // Never resolves within the assertion window — proves the insert is
    // optimistic (onMutate), not dependent on the mutation settling.
    put.mockReturnValue({ json: () => new Promise(() => {}) });
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    queryClient.setQueryData<PinnedItem[]>(pinQueryKeys.list(), []);

    const { result } = renderHook(() => usePinItem(), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({
      itemType: "chat",
      itemId: "c1",
      card: { id: "c1", title: "My chat" },
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<PinnedItem[]>(
        pinQueryKeys.list(),
      );
      expect(cached?.[0]).toMatchObject({
        itemType: "chat",
        itemId: "c1",
        item: { id: "c1", title: "My chat" },
      });
    });
  });

  it("rolls back the optimistic insert and toasts on failure", async () => {
    put.mockReturnValue({ json: () => Promise.reject(new Error("down")) });
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    queryClient.setQueryData<PinnedItem[]>(pinQueryKeys.list(), []);

    const { result } = renderHook(() => usePinItem(), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({
      itemType: "project",
      itemId: "p1",
      card: { id: "p1", name: "Acme" },
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith("Couldn't pin the project.");
    expect(queryClient.getQueryData<PinnedItem[]>(pinQueryKeys.list())).toEqual(
      [],
    );
  });
});

describe("useUnpinItem", () => {
  it("optimistically removes the pin from the cache", async () => {
    del.mockReturnValue(new Promise(() => {}));
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const existing: PinnedItem = {
      itemType: "chat",
      itemId: "c1",
      pinnedAt: "2026-01-01T00:00:00.000Z",
      item: { id: "c1", title: "My chat" },
    };
    queryClient.setQueryData<PinnedItem[]>(pinQueryKeys.list(), [existing]);

    const { result } = renderHook(() => useUnpinItem(), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({ itemType: "chat", itemId: "c1" });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<PinnedItem[]>(pinQueryKeys.list()),
      ).toEqual([]),
    );
  });

  it("toasts an unpin-specific message on failure", async () => {
    del.mockRejectedValue(new Error("down"));
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    const { result } = renderHook(() => useUnpinItem(), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({ itemType: "chat", itemId: "c1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith("Couldn't unpin the chat.");
  });
});
