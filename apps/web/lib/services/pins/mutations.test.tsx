// @vitest-environment jsdom

/**
 * Pin/unpin via the unified, idempotent PUT/DELETE /api/v1/pins/:itemType/:itemId
 * resource (design D2) — the plain HTTP functions, then hook-level coverage for
 * the optimistic card synthesis (design D5a) and the toast-on-failure behavior
 * (mirrors ../chat/management-mutations.test.tsx's convention).
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
  pinItem,
  unpinItem,
  usePinItem,
  useReorderPins,
  useUnpinItem,
} from "./mutations";
import { pinQueryKeys } from "./queries";
import type { PinnedItem } from "./types";
import {
  emptyResponse,
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pinItem", () => {
  it("pins through the generated authenticated endpoint", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        itemType: "chat",
        itemId: "c1",
        pinnedAt: "2026-01-01T00:00:00.000Z",
        item: { id: "c1", title: "Hi", archivedAt: null },
      }),
    );
    await pinItem("chat", "c1");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PUT");
    expect(new URL(request.url).pathname).toBe("/api/v1/pins/chat/c1");
  });
});

describe("unpinItem", () => {
  it("unpins through the generated authenticated endpoint", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    await unpinItem("project", "p1");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).pathname).toBe("/api/v1/pins/project/p1");
  });

  it("swallows a 404 (already unpinned) as success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 404));
    await expect(unpinItem("chat", "gone")).resolves.toBeUndefined();
  });

  it("rethrows non-404 errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500));
    await expect(unpinItem("chat", "c1")).rejects.toMatchObject({
      status: 500,
    });
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
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    queryClient.setQueryData<Array<PinnedItem>>(pinQueryKeys.list(), []);

    const { result } = renderHook(() => usePinItem(), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({
      itemType: "chat",
      itemId: "c1",
      card: { id: "c1", title: "My chat", archivedAt: null },
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<Array<PinnedItem>>(
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
    fetchMock.mockRejectedValue(new Error("down"));
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    queryClient.setQueryData<Array<PinnedItem>>(pinQueryKeys.list(), []);

    const { result } = renderHook(() => usePinItem(), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({
      itemType: "project",
      itemId: "p1",
      card: { id: "p1", name: "Acme", archivedAt: null },
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorSpy).toHaveBeenCalledWith("Couldn't pin the project.");
    expect(
      queryClient.getQueryData<Array<PinnedItem>>(pinQueryKeys.list()),
    ).toEqual([]);
  });
});

describe("useUnpinItem", () => {
  it("optimistically removes the pin from the cache", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const existing: PinnedItem = {
      itemType: "chat",
      itemId: "c1",
      pinnedAt: "2026-01-01T00:00:00.000Z",
      item: { id: "c1", title: "My chat", archivedAt: null },
    };
    queryClient.setQueryData<Array<PinnedItem>>(pinQueryKeys.list(), [
      existing,
    ]);

    const { result } = renderHook(() => useUnpinItem(), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({ itemType: "chat", itemId: "c1" });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<Array<PinnedItem>>(pinQueryKeys.list()),
      ).toEqual([]),
    );
  });

  it("toasts an unpin-specific message on failure", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    const { result } = renderHook(() => useUnpinItem(), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({ itemType: "chat", itemId: "c1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorSpy).toHaveBeenCalledWith("Couldn't unpin the chat.");
  });
});

describe("useReorderPins", () => {
  const pinA: PinnedItem = {
    itemType: "chat",
    itemId: "c1",
    pinnedAt: "2026-01-01T00:00:00.000Z",
    item: { id: "c1", title: "A", archivedAt: null },
  };
  const pinB: PinnedItem = {
    itemType: "project",
    itemId: "p1",
    pinnedAt: "2026-01-02T00:00:00.000Z",
    item: { id: "p1", name: "B", archivedAt: null },
  };

  it("optimistically rewrites the pins cache to the submitted order", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    queryClient.setQueryData<Array<PinnedItem>>(pinQueryKeys.list(), [
      pinA,
      pinB,
    ]);

    const { result } = renderHook(() => useReorderPins(), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate([pinB, pinA]);

    await waitFor(() =>
      expect(
        queryClient.getQueryData<Array<PinnedItem>>(pinQueryKeys.list()),
      ).toEqual([pinB, pinA]),
    );
  });

  it("serializes overlapping reorders so the later submission wins", async () => {
    let resolveFirst: (response: Response) => void = () => {};
    const firstCall = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    fetchMock
      .mockImplementationOnce(() => firstCall)
      .mockResolvedValueOnce(jsonResponse([pinB, pinA]));

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    queryClient.setQueryData<Array<PinnedItem>>(pinQueryKeys.list(), [
      pinA,
      pinB,
    ]);

    const { result } = renderHook(() => useReorderPins(), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate([pinA, pinB]);
    result.current.mutate([pinB, pinA]);

    // Scope keeps the second request queued until the first settles.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveFirst(jsonResponse([pinA, pinB]));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        queryClient.getQueryData<Array<PinnedItem>>(pinQueryKeys.list()),
      ).toEqual([pinB, pinA]),
    );
    const secondRequest = requestFromCall(fetchMock, 1);
    await expect(secondRequest.clone().json()).resolves.toEqual({
      items: [
        { itemType: "project", itemId: "p1" },
        { itemType: "chat", itemId: "c1" },
      ],
    });
  });
});
