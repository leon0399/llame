import { afterEach, describe, expect, it, vi } from "vitest";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("../../api/client", () => ({
  api: {
    get: (...a: unknown[]) => ({ json: () => get(...a) }),
    post: (...a: unknown[]) => ({ json: () => post(...a) }),
  },
  buildApiUrl: (path: string) => `http://api${path}`,
}));

import { fetchSharedChat, forkSharedChat } from "./shared";

afterEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("fetchSharedChat", () => {
  it("GETs the public /shared/chats/:id endpoint with no search params by default", async () => {
    get.mockResolvedValue({ id: "c1", title: "x", messages: [] });
    const result = await fetchSharedChat("c1");
    expect(get).toHaveBeenCalledWith("http://api/api/v1/shared/chats/c1", {
      searchParams: {},
    });
    expect(result.id).toBe("c1");
  });

  it("forwards limit/beforeSeq as search params for cursor pagination", async () => {
    get.mockResolvedValue({ id: "c1", title: "x", messages: [] });
    await fetchSharedChat("c1", { limit: 100, beforeSeq: 42 });
    expect(get).toHaveBeenCalledWith("http://api/api/v1/shared/chats/c1", {
      searchParams: { limit: 100, beforeSeq: 42 },
    });
  });
});

describe("forkSharedChat", () => {
  it("POSTs the shared chat's forks sub-collection", async () => {
    post.mockResolvedValue({ id: "new-chat" });
    const result = await forkSharedChat("c1");
    expect(post).toHaveBeenCalledWith(
      "http://api/api/v1/shared/chats/c1/forks",
    );
    expect(result.id).toBe("new-chat");
  });
});
