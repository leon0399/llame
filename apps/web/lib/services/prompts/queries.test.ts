import { afterEach, describe, expect, it, vi } from "vitest";

const { get, post, patch, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: {
    get: (...a: unknown[]) => ({ json: () => get(...a) }),
    post: (...a: unknown[]) => ({ json: () => post(...a) }),
    patch: (...a: unknown[]) => ({ json: () => patch(...a) }),
    delete: (...a: unknown[]) => del(...a),
  },
  buildApiUrl: (path: string) => `http://api${path}`,
}));

import {
  createPrompt,
  deletePrompt,
  fetchPrompts,
  updatePrompt,
} from "./queries";

afterEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  del.mockReset();
});

describe("prompts service", () => {
  it("fetchPrompts GETs the collection", async () => {
    get.mockResolvedValue([{ id: "1", name: "sum", content: "x" }]);
    expect(await fetchPrompts()).toHaveLength(1);
    expect(get).toHaveBeenCalledWith("http://api/api/v1/me/prompts");
  });

  it("createPrompt POSTs { name, content }", async () => {
    post.mockResolvedValue({ id: "2" });
    await createPrompt({ name: "sum", content: "Summarize: " });
    expect(post).toHaveBeenCalledWith("http://api/api/v1/me/prompts", {
      json: { name: "sum", content: "Summarize: " },
    });
  });

  it("updatePrompt PATCHes by id", async () => {
    patch.mockResolvedValue({ id: "2" });
    await updatePrompt("2", { content: "new" });
    expect(patch).toHaveBeenCalledWith("http://api/api/v1/me/prompts/2", {
      json: { content: "new" },
    });
  });

  it("deletePrompt DELETEs by id", async () => {
    del.mockResolvedValue(undefined);
    await deletePrompt("2");
    expect(del).toHaveBeenCalledWith("http://api/api/v1/me/prompts/2");
  });
});
