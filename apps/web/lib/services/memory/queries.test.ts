import { afterEach, describe, expect, it, vi } from "vitest";

const getMemory = vi.hoisted(() => vi.fn());
const authenticatedFetch = vi.hoisted(() => vi.fn());
const createAuthenticatedBrowserFetch = vi.hoisted(() => vi.fn());
const useQuery = vi.hoisted(() => vi.fn());

vi.mock("../../api/generated/memory/memory", () => ({ getMemory }));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch,
}));
vi.mock("@tanstack/react-query", () => ({ useQuery }));

import { fetchMemory, memoryQueryKeys, useMemoryQuery } from "./queries";

createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);

afterEach(() => {
  vi.clearAllMocks();
  createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);
});

describe("memory query keys", () => {
  it("keeps the resource-path keys", () => {
    expect(memoryQueryKeys.all).toEqual(["memory"]);
    expect(memoryQueryKeys.mine()).toEqual(["memory", "me"]);
  });
});

describe("memory query transport", () => {
  it("fetches the caller's memory through the generated authenticated endpoint", async () => {
    const response = { shareRecentChats: false };
    getMemory.mockResolvedValue(response);

    await expect(fetchMemory()).resolves.toEqual(response);

    expect(getMemory).toHaveBeenCalledWith(undefined, authenticatedFetch);
    expect(createAuthenticatedBrowserFetch).toHaveBeenCalledWith(
      globalThis.fetch,
    );
  });

  it("preserves the memory query key and default query options", () => {
    useMemoryQuery();

    expect(useQuery).toHaveBeenCalledWith({
      queryKey: memoryQueryKeys.mine(),
      queryFn: fetchMemory,
    });
  });
});
