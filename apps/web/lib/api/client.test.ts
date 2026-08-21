import { afterEach, describe, expect, it, vi } from "vitest";
import { authAwareFetch, buildApiUrl } from "./client";

describe("buildApiUrl", () => {
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

  afterEach(() => {
    if (originalApiUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
    } else {
      process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
    }
  });

  it("builds absolute api URLs from NEXT_PUBLIC_API_URL", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com/";

    expect(buildApiUrl("/auth/v1/me")).toBe(
      "https://api.example.com/auth/v1/me",
    );
    expect(buildApiUrl("api/v1/chats")).toBe(
      "https://api.example.com/api/v1/chats",
    );
  });

  it("uses the shared browser Fetch policy for chat transport requests", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com/";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await authAwareFetch("/api/v1/chats/chat-1/messages", {
      method: "POST",
    });

    const [input] = fetchMock.mock.calls[0]!;
    const request = input instanceof Request ? input : new Request(input);
    expect(request).toBeInstanceOf(Request);
    expect(request.url).toBe(
      "https://api.example.com/api/v1/chats/chat-1/messages",
    );
    expect(request.credentials).toBe("include");
  });
});
