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

const pinItemEndpoint = vi.hoisted(() => vi.fn());
const unpinItemEndpoint = vi.hoisted(() => vi.fn());
const authenticatedFetch = vi.hoisted(() => vi.fn());
const createAuthenticatedBrowserFetch = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("../../api/generated/pins/pins", () => ({
  pinItem: pinItemEndpoint,
  unpinItem: unpinItemEndpoint,
}));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch,
}));
vi.mock("@workspace/ui/components/sonner", () => ({
  toast: { error: toastError },
}));

import { pinItem, unpinItem, usePinItem, useUnpinItem } from "./mutations";
import { pinQueryKeys } from "./queries";
import type { PinnedItem } from "./types";

createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);

afterEach(() => {
  vi.clearAllMocks();
  createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);
});

describe("pinItem", () => {
  it("pins through the generated authenticated endpoint", async () => {
    pinItemEndpoint.mockResolvedValue({
      itemType: "chat",
      itemId: "c1",
      pinnedAt: "2026-01-01T00:00:00.000Z",
      item: { id: "c1", title: "Hi", archivedAt: null },
    });
    await pinItem("chat", "c1");
    expect(pinItemEndpoint).toHaveBeenCalledWith(
      "chat",
      "c1",
      undefined,
      authenticatedFetch,
    );
  });
});

describe("unpinItem", () => {
  it("unpins through the generated authenticated endpoint", async () => {
    unpinItemEndpoint.mockResolvedValue(undefined);
    await unpinItem("project", "p1");
    expect(unpinItemEndpoint).toHaveBeenCalledWith(
      "project",
      "p1",
      undefined,
      authenticatedFetch,
    );
  });

  it("swallows a 404 (already unpinned) as success", async () => {
    unpinItemEndpoint.mockRejectedValue({ status: 404, info: {} });
    await expect(unpinItem("chat", "gone")).resolves.toBeUndefined();
  });

  it("rethrows non-404 errors", async () => {
    const error = { status: 500, info: {} };
    unpinItemEndpoint.mockRejectedValue(error);
    await expect(unpinItem("chat", "c1")).rejects.toBe(error);
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
    pinItemEndpoint.mockReturnValue(new Promise(() => {}));
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
      card: { id: "c1", title: "My chat", archivedAt: null },
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
    pinItemEndpoint.mockRejectedValue(new Error("down"));
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
      card: { id: "p1", name: "Acme", archivedAt: null },
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
    unpinItemEndpoint.mockReturnValue(new Promise(() => {}));
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const existing: PinnedItem = {
      itemType: "chat",
      itemId: "c1",
      pinnedAt: "2026-01-01T00:00:00.000Z",
      item: { id: "c1", title: "My chat", archivedAt: null },
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
    unpinItemEndpoint.mockRejectedValue(new Error("down"));
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
