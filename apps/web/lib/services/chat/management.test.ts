import { afterEach, describe, expect, it, vi } from "vitest";

const { patch, del, FakeHTTPError } = vi.hoisted(() => {
  class FakeHTTPError extends Error {
    response: { status: number };
    constructor(status: number) {
      super(`HTTP ${status}`);
      this.response = { status };
    }
  }
  return { patch: vi.fn(), del: vi.fn(), FakeHTTPError };
});

vi.mock("ky", () => ({ HTTPError: FakeHTTPError }));
vi.mock("../../api/client", () => ({
  api: { patch, delete: del },
  buildApiUrl: (path: string) => `http://api${path}`,
}));

import {
  deleteChat,
  renameChat,
  setChatPinned,
  setChatVisibility,
} from "./management";

afterEach(() => {
  patch.mockReset();
  del.mockReset();
});

describe("renameChat", () => {
  it("PATCHes /chats/:id with the new title", async () => {
    patch.mockResolvedValue(undefined);
    await renameChat("c1", "New title");
    expect(patch).toHaveBeenCalledWith("http://api/api/v1/chats/c1", {
      json: { title: "New title" },
    });
  });
});

describe("setChatPinned", () => {
  it("PATCHes /chats/:id with the pinned flag", async () => {
    patch.mockResolvedValue(undefined);
    await setChatPinned("c1", true);
    expect(patch).toHaveBeenCalledWith("http://api/api/v1/chats/c1", {
      json: { pinned: true },
    });
  });
});

describe("setChatVisibility", () => {
  it("PATCHes /chats/:id with the visibility", async () => {
    patch.mockResolvedValue(undefined);
    await setChatVisibility("c1", "public");
    expect(patch).toHaveBeenCalledWith("http://api/api/v1/chats/c1", {
      json: { visibility: "public" },
    });
  });
});

describe("deleteChat", () => {
  it("DELETEs /chats/:id", async () => {
    del.mockResolvedValue(undefined);
    await deleteChat("c1");
    expect(del).toHaveBeenCalledWith("http://api/api/v1/chats/c1");
  });

  it("swallows a 404 (already deleted) as success", async () => {
    del.mockRejectedValue(new FakeHTTPError(404));
    await expect(deleteChat("gone")).resolves.toBeUndefined();
  });

  it("rethrows non-404 errors", async () => {
    del.mockRejectedValue(new FakeHTTPError(500));
    await expect(deleteChat("c1")).rejects.toBeInstanceOf(FakeHTTPError);
  });
});
