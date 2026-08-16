import { afterEach, describe, expect, it, vi } from "vitest";

describe("fetchMeOptional", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("requests /auth/v1/me with credentials included, regardless of outcome", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const { fetchMeOptional } = await import("./queries");
    await fetchMeOptional();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/v1/me"),
      { credentials: "include" },
    );
  });

  it("returns null on a 401 — never throws, never redirects", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 401 })),
    );

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
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(user), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      ),
    );

    const { fetchMeOptional } = await import("./queries");
    await expect(fetchMeOptional()).resolves.toEqual(user);
  });

  it("throws on a non-401 error status (a real failure, not 'signed out')", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 500 })),
    );

    const { fetchMeOptional } = await import("./queries");
    await expect(fetchMeOptional()).rejects.toThrow(
      /Failed to check auth state/,
    );
  });
});
