import { afterEach, describe, expect, it, vi } from "vitest";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("../../api/client", () => ({
  api: { post },
  buildApiUrl: (path: string) => `http://api${path}`,
}));

import { forkChat } from "./fork";

afterEach(() => {
  post.mockReset();
});

describe("forkChat", () => {
  it("POSTs the forks sub-collection with the fork-point message id", async () => {
    const json = vi.fn().mockResolvedValue({ id: "forked-chat" });
    post.mockReturnValue({ json });

    const result = await forkChat("chat-1", "msg-1");

    expect(post).toHaveBeenCalledWith("http://api/api/v1/chats/chat-1/forks", {
      json: { fromMessageId: "msg-1" },
    });
    expect(result).toEqual({ id: "forked-chat" });
  });

  it("POSTs with no fromMessageId when omitted — forks the whole chat (clone)", async () => {
    const json = vi.fn().mockResolvedValue({ id: "cloned-chat" });
    post.mockReturnValue({ json });

    const result = await forkChat("chat-1");

    const [url, options] = post.mock.calls[0] as [string, { json: unknown }];
    expect(url).toBe("http://api/api/v1/chats/chat-1/forks");
    // JSON.stringify drops the undefined property — assert the wire shape,
    // not just the JS object identity.
    expect(JSON.stringify(options.json)).toBe("{}");
    expect(result).toEqual({ id: "cloned-chat" });
  });
});
