import { afterEach, describe, expect, it, vi } from "vitest";

describe("fetchMeOptional", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetModules();
  });

  it("requests /auth/v1/me with credentials included, regardless of outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 401,
      ok: false,
    }) as unknown as typeof fetch;
    global.fetch = fetchMock;

    const { fetchMeOptional } = await import("./queries");
    await fetchMeOptional();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/v1/me"),
      { credentials: "include" },
    );
  });

  it("returns null on a 401 — never throws, never redirects", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 401,
      ok: false,
    }) as unknown as typeof fetch;

    const { fetchMeOptional } = await import("./queries");
    await expect(fetchMeOptional()).resolves.toBeNull();
  });

  it("returns the user on success", async () => {
    const user = {
      id: "u1",
      name: "A",
      email: null,
      emailVerified: null,
      image: null,
    };
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve(user),
    }) as unknown as typeof fetch;

    const { fetchMeOptional } = await import("./queries");
    await expect(fetchMeOptional()).resolves.toEqual(user);
  });

  it("throws on a non-401 error status (a real failure, not 'signed out')", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 500,
      ok: false,
    }) as unknown as typeof fetch;

    const { fetchMeOptional } = await import("./queries");
    await expect(fetchMeOptional()).rejects.toThrow();
  });
});
