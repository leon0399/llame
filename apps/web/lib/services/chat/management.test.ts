import { afterEach, describe, expect, it, vi } from "vitest";

const { updateChat, deleteChatEndpoint } = vi.hoisted(() => ({
  updateChat: vi.fn(),
  deleteChatEndpoint: vi.fn(),
}));

vi.mock("../../api/generated/chats/chats", () => ({
  updateChat,
  deleteChat: deleteChatEndpoint,
}));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch: () => vi.fn(),
}));

import { deleteChat, renameChat, setChatVisibility } from "./management";

afterEach(() => {
  updateChat.mockReset();
  deleteChatEndpoint.mockReset();
});

describe("renameChat", () => {
  it("PATCHes /chats/:id with the new title", async () => {
    updateChat.mockResolvedValue(undefined);
    await renameChat("c1", "New title");
    expect(updateChat).toHaveBeenCalledWith(
      "c1",
      { title: "New title" },
      undefined,
      expect.any(Function),
    );
  });
});

describe("setChatVisibility", () => {
  it("PATCHes /chats/:id with the visibility", async () => {
    updateChat.mockResolvedValue(undefined);
    await setChatVisibility("c1", "public");
    expect(updateChat).toHaveBeenCalledWith(
      "c1",
      { visibility: "public" },
      undefined,
      expect.any(Function),
    );
  });
});

describe("deleteChat", () => {
  it("DELETEs /chats/:id", async () => {
    deleteChatEndpoint.mockResolvedValue(undefined);
    await deleteChat("c1");
    expect(deleteChatEndpoint).toHaveBeenCalledWith(
      "c1",
      undefined,
      expect.any(Function),
    );
  });

  it("swallows a 404 (already deleted) as success", async () => {
    deleteChatEndpoint.mockRejectedValue({ status: 404, info: {} });
    await expect(deleteChat("gone")).resolves.toBeUndefined();
  });

  it("rethrows non-404 errors", async () => {
    const error = { status: 500, info: {} };
    deleteChatEndpoint.mockRejectedValue(error);
    await expect(deleteChat("c1")).rejects.toBe(error);
  });
});
