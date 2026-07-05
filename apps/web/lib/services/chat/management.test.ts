import { afterEach, describe, expect, it, vi } from "vitest";

const { patch } = vi.hoisted(() => ({ patch: vi.fn() }));

vi.mock("../../api/client", () => ({
  api: { patch: (...a: unknown[]) => patch(...a) },
  buildApiUrl: (path: string) => `http://api${path}`,
}));

import { setChatVisibility } from "./management";

afterEach(() => {
  patch.mockReset();
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
