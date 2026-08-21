import { afterEach, describe, expect, it, vi } from "vitest";

const { getSharedChatEndpoint, forkSharedChatEndpoint } = vi.hoisted(() => ({
  getSharedChatEndpoint: vi.fn(),
  forkSharedChatEndpoint: vi.fn(),
}));

vi.mock("../../api/generated/chats/chats", () => ({
  getSharedChat: getSharedChatEndpoint,
  forkSharedChat: forkSharedChatEndpoint,
}));
vi.mock("../../api/fetch", () => ({
  createOptionalAuthFetch: () => vi.fn(),
  createAuthenticatedBrowserFetch: () => vi.fn(),
}));

import { fetchSharedChat, forkSharedChat } from "./shared";

afterEach(() => {
  getSharedChatEndpoint.mockReset();
  forkSharedChatEndpoint.mockReset();
});

describe("fetchSharedChat", () => {
  it("GETs the public /shared/chats/:id endpoint with no search params by default", async () => {
    getSharedChatEndpoint.mockResolvedValue({
      id: "c1",
      title: "x",
      messages: [],
    });
    const result = await fetchSharedChat("c1");
    expect(getSharedChatEndpoint).toHaveBeenCalledWith(
      "c1",
      undefined,
      undefined,
      expect.any(Function),
    );
    expect(result.id).toBe("c1");
  });

  it("forwards limit/beforeSeq as search params for cursor pagination", async () => {
    getSharedChatEndpoint.mockResolvedValue({
      id: "c1",
      title: "x",
      messages: [],
    });
    await fetchSharedChat("c1", { limit: 100, beforeSeq: 42 });
    expect(getSharedChatEndpoint).toHaveBeenCalledWith(
      "c1",
      { limit: 100, beforeSeq: 42 },
      undefined,
      expect.any(Function),
    );
  });
});

describe("forkSharedChat", () => {
  it("POSTs the shared chat's forks sub-collection", async () => {
    forkSharedChatEndpoint.mockResolvedValue({ id: "new-chat" });
    const result = await forkSharedChat("c1");
    expect(forkSharedChatEndpoint).toHaveBeenCalledWith(
      "c1",
      undefined,
      expect.any(Function),
    );
    expect(result.id).toBe("new-chat");
  });
});
