// @vitest-environment jsdom

/**
 * Targeted coverage for two branches not reached by app-sidebar-pinned.test.tsx
 * (which already exercises usePinItem/useUnpinItem's happy paths through the
 * rendered rail): usePinItem's optimistic dedup-replace of an already-pinned
 * item, and useReorderPins' error rollback. Real hooks run against a stubbed
 * globalThis.fetch — no first-party module mocking.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { usePinItem, useReorderPins } from "./mutations";
import { pinQueryKeys } from "./queries";
import type { PinnedItem } from "./types";
import { stubFetch } from "../../test-support/fetch-stub";
import {
  newTestQueryClient,
  wrapperWithClient,
} from "../../test-support/query-client";

let fetchMock: Mock<typeof fetch>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePinItem", () => {
  it("optimistically replaces an already-pinned entry instead of duplicating it", async () => {
    fetchMock = stubFetch();
    fetchMock.mockImplementation(() => new Promise(() => {})); // never resolves
    const queryClient = newTestQueryClient();
    const existing: Array<PinnedItem> = [
      {
        itemType: "chat",
        itemId: "c1",
        pinnedAt: "2026-01-01T00:00:00.000Z",
        item: { id: "c1", title: "Old", archivedAt: null },
      },
    ];
    queryClient.setQueryData(pinQueryKeys.list(), existing);

    const { result } = renderHook(() => usePinItem(), {
      wrapper: wrapperWithClient(queryClient),
    });

    result.current.mutate({
      itemType: "chat",
      itemId: "c1",
      card: { id: "c1", title: "New title", archivedAt: null },
    });

    await waitFor(() => {
      const pins = queryClient.getQueryData<Array<PinnedItem>>(
        pinQueryKeys.list(),
      );
      expect(pins).toHaveLength(1);
    });
    const [pin] = queryClient.getQueryData<Array<PinnedItem>>(
      pinQueryKeys.list(),
    )!;
    if (pin?.itemType !== "chat") throw new Error("expected a chat pin");
    expect(pin.item.title).toBe("New title");
  });
});

describe("useReorderPins", () => {
  it("rolls back the optimistic order on a failed PUT", async () => {
    fetchMock = stubFetch();
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const queryClient = newTestQueryClient();
    const original: Array<PinnedItem> = [
      {
        itemType: "chat",
        itemId: "c1",
        pinnedAt: "2026-01-01T00:00:00.000Z",
        item: { id: "c1", title: "First", archivedAt: null },
      },
      {
        itemType: "chat",
        itemId: "c2",
        pinnedAt: "2026-01-02T00:00:00.000Z",
        item: { id: "c2", title: "Second", archivedAt: null },
      },
    ];
    queryClient.setQueryData(pinQueryKeys.list(), original);

    const { result } = renderHook(() => useReorderPins(), {
      wrapper: wrapperWithClient(queryClient),
    });

    result.current.mutate([original[1]!, original[0]!]);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      queryClient.getQueryData<Array<PinnedItem>>(pinQueryKeys.list()),
    ).toEqual(original);
  });
});
