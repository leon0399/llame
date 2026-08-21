import { afterEach, describe, expect, it, vi } from "vitest";

const listPinsEndpoint = vi.hoisted(() => vi.fn());
const authenticatedFetch = vi.hoisted(() => vi.fn());
const createAuthenticatedBrowserFetch = vi.hoisted(() => vi.fn());

vi.mock("../../api/generated/pins/pins", () => ({
  listPins: listPinsEndpoint,
}));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch,
}));

import {
  fetchPins,
  pinQueryKeys,
  selectPinnedChatMap,
  selectPinnedProjectMap,
} from "./queries";
import type { PinnedItem } from "./types";

createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);

afterEach(() => {
  vi.clearAllMocks();
  createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);
});

describe("fetchPins", () => {
  it("lists pins through the generated authenticated endpoint", async () => {
    listPinsEndpoint.mockResolvedValue([]);

    await expect(fetchPins()).resolves.toEqual([]);

    expect(listPinsEndpoint).toHaveBeenCalledWith(
      undefined,
      authenticatedFetch,
    );
    expect(createAuthenticatedBrowserFetch).toHaveBeenCalledWith(
      globalThis.fetch,
    );
  });
});

describe("pin query keys and selectors", () => {
  it("keeps the resource-path list key", () => {
    expect(pinQueryKeys.all).toEqual(["pins"]);
    expect(pinQueryKeys.list()).toEqual(["pins", "list"]);
  });

  it("narrows generated pin unions by item type", () => {
    const pins: PinnedItem[] = [
      {
        itemType: "chat",
        itemId: "c1",
        pinnedAt: "2026-01-01T00:00:00.000Z",
        item: { id: "c1", title: "Chat", archivedAt: null },
      },
      {
        itemType: "project",
        itemId: "p1",
        pinnedAt: "2026-01-02T00:00:00.000Z",
        item: { id: "p1", name: "Project", archivedAt: null },
      },
    ];

    expect([...selectPinnedChatMap(pins).entries()]).toEqual([
      ["c1", "2026-01-01T00:00:00.000Z"],
    ]);
    expect([...selectPinnedProjectMap(pins).entries()]).toEqual([
      ["p1", "2026-01-02T00:00:00.000Z"],
    ]);
  });
});
