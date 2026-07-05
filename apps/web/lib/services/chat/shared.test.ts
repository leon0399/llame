import { afterEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../api/client", () => ({
  api: { get: (...a: unknown[]) => ({ json: () => get(...a) }) },
  buildApiUrl: (path: string) => `http://api${path}`,
}));

import { fetchSharedChat } from "./shared";

afterEach(() => get.mockReset());

describe("fetchSharedChat", () => {
  it("GETs the public /shared/chats/:id endpoint", async () => {
    get.mockResolvedValue({ id: "c1", title: "x", messages: [] });
    const result = await fetchSharedChat("c1");
    expect(get).toHaveBeenCalledWith("http://api/api/v1/shared/chats/c1");
    expect(result.id).toBe("c1");
  });
});
