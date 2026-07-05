import { afterEach, describe, expect, it, vi } from "vitest";

const { get, post, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: {
    get: (...a: unknown[]) => ({ json: () => get(...a) }),
    post: (...a: unknown[]) => ({ json: () => post(...a) }),
    delete: (...a: unknown[]) => del(...a),
  },
  buildApiUrl: (path: string) => `http://api${path}`,
}));

import { createMemory, deleteMemory, fetchMemories } from "./queries";

afterEach(() => {
  get.mockReset();
  post.mockReset();
  del.mockReset();
});

describe("memories service", () => {
  it("fetchMemories GETs the collection", async () => {
    get.mockResolvedValue([{ id: "1", content: "x", source: "user" }]);
    const rows = await fetchMemories();
    expect(get).toHaveBeenCalledWith("http://api/api/v1/me/memories");
    expect(rows).toHaveLength(1);
  });

  it("createMemory POSTs { content }", async () => {
    post.mockResolvedValue({ id: "2", content: "hi", source: "user" });
    await createMemory("hi");
    expect(post).toHaveBeenCalledWith("http://api/api/v1/me/memories", {
      json: { content: "hi" },
    });
  });

  it("deleteMemory DELETEs by id", async () => {
    del.mockResolvedValue(undefined);
    await deleteMemory("abc");
    expect(del).toHaveBeenCalledWith("http://api/api/v1/me/memories/abc");
  });
});
