import { afterEach, describe, expect, it, vi } from "vitest";

const { forkChatEndpoint } = vi.hoisted(() => ({ forkChatEndpoint: vi.fn() }));

vi.mock("../../api/generated/chats/chats", () => ({
  forkChat: forkChatEndpoint,
}));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch: () => vi.fn(),
}));

import { forkChat } from "./fork";

afterEach(() => {
  forkChatEndpoint.mockReset();
});

describe("forkChat", () => {
  it("POSTs the forks sub-collection with the fork-point message id", async () => {
    forkChatEndpoint.mockResolvedValue({ id: "forked-chat" });

    const result = await forkChat("chat-1", "msg-1");

    expect(forkChatEndpoint).toHaveBeenCalledWith(
      "chat-1",
      { fromMessageId: "msg-1" },
      undefined,
      expect.any(Function),
    );
    expect(result).toEqual({ id: "forked-chat" });
  });

  it("POSTs with no fromMessageId when omitted — forks the whole chat (clone)", async () => {
    forkChatEndpoint.mockResolvedValue({ id: "cloned-chat" });

    const result = await forkChat("chat-1");

    const [, options] = forkChatEndpoint.mock.calls[0] as [
      string,
      { fromMessageId?: string },
    ];
    // JSON.stringify drops the undefined property — assert the wire shape,
    // not just the JS object identity.
    expect(JSON.stringify(options)).toBe("{}");
    expect(result).toEqual({ id: "cloned-chat" });
  });
});
