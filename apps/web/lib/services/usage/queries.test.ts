import { afterEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../api/client", () => ({
  api: { get: (...a: unknown[]) => ({ json: () => get(...a) }) },
  buildApiUrl: (path: string) => `http://api${path}`,
}));

import { fetchUsage } from "./queries";

afterEach(() => get.mockReset());

describe("fetchUsage", () => {
  it("GETs /me/usage with the days window", async () => {
    get.mockResolvedValue({ days: 7, total: {}, byModel: [], byDay: [] });
    await fetchUsage(7);
    const [url] = get.mock.calls[0] as [string];
    expect(url).toContain("http://api/api/v1/me/usage");
    expect(url).toContain("days=7");
  });
});
