import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import {
  fetchPins,
  pinQueryKeys,
  selectPinnedChatMap,
  selectPinnedProjectMap,
} from "./queries";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";
import type { PinnedItem } from "./types";

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPins", () => {
  it("lists pins through the generated authenticated endpoint", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await expect(fetchPins()).resolves.toEqual([]);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/api/v1/pins");
    expect(request.credentials).toBe("include");
  });
});

describe("pin query keys and selectors", () => {
  it("keeps the resource-path list key", () => {
    expect(pinQueryKeys.all).toEqual(["pins"]);
    expect(pinQueryKeys.list()).toEqual(["pins", "list"]);
  });

  it("narrows generated pin unions by item type", () => {
    const pins: Array<PinnedItem> = [
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
