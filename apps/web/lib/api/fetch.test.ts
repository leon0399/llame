import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthenticatedBrowserFetch,
  createOptionalAuthFetch,
  createServerFetch,
  registerApiQueryClient,
} from "./fetch";

function requestFromCall(call: Parameters<typeof fetch>): Request {
  const [input, init] = call;
  return input instanceof Request ? input : new Request(input, init);
}

describe("Fetch policies", () => {
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com/";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalApiUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
    } else {
      process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
    }
  });

  it("resolves relative API and auth paths against the configured origin", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const fetchWithAuth = createAuthenticatedBrowserFetch(fetchMock);

    await fetchWithAuth("/api/v1/projects");
    await fetchWithAuth("/auth/v1/me");

    expect(requestFromCall(fetchMock.mock.calls[0]!)).toMatchObject({
      url: "https://api.example.com/api/v1/projects",
    });
    expect(requestFromCall(fetchMock.mock.calls[1]!)).toMatchObject({
      url: "https://api.example.com/auth/v1/me",
    });
  });

  it("defaults browser credentials and preserves request options", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const fetchWithAuth = createAuthenticatedBrowserFetch(fetchMock);
    const controller = new AbortController();
    const body = JSON.stringify({ name: "new project" });

    await fetchWithAuth("/api/v1/projects", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "request-1",
      },
      body,
      cache: "no-store",
      signal: controller.signal,
    });

    const request = requestFromCall(fetchMock.mock.calls[0]!);
    expect(request.credentials).toBe("include");
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.get("x-request-id")).toBe("request-1");
    expect(request.cache).toBe("no-store");
    expect(await request.text()).toBe(body);

    controller.abort();
    expect(request.signal.aborted).toBe(true);
  });

  it("constructs a POST request once while applying the browser policy", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const requestConstructor = vi.fn();
    const NativeRequest = globalThis.Request;
    class TrackedRequest extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        requestConstructor();
        super(input, init);
      }
    }
    vi.stubGlobal("Request", TrackedRequest);
    const fetchWithAuth = createAuthenticatedBrowserFetch(fetchMock);
    const body = JSON.stringify({ message: "hello" });

    try {
      await fetchWithAuth("/api/v1/chats/chat-1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    } finally {
      vi.stubGlobal("Request", NativeRequest);
    }

    expect(requestConstructor).toHaveBeenCalledOnce();
    const [input] = fetchMock.mock.calls[0]!;
    expect(input).toBeInstanceOf(Request);
    expect(input).toMatchObject({
      credentials: "include",
      method: "POST",
      url: "https://api.example.com/api/v1/chats/chat-1/messages",
    });
    // SAFETY: the `toBeInstanceOf(Request)` assertion above just proved
    // `input` is a `Request` at runtime.
    expect(await (input as Request).text()).toBe(body);
  });

  it("clears the registered query client and redirects on an unexpected browser 401", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));
    const queryClient = new QueryClient();
    const clear = vi.spyOn(queryClient, "clear");
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: { pathname: "/settings", search: "?tab=account", assign },
    });
    registerApiQueryClient(queryClient);

    await createAuthenticatedBrowserFetch(fetchMock)("/api/v1/me");

    expect(clear).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith(
      "/login?callbackUrl=%2Fsettings%3Ftab%3Daccount",
    );
  });

  it.each(["/auth/v1/login", "/auth/v1/register"])(
    "passes credential-submission 401 through without browser effects (%s)",
    async (path) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 401 }));
      const queryClient = new QueryClient();
      const clear = vi.spyOn(queryClient, "clear");
      const assign = vi.fn();
      vi.stubGlobal("window", {
        location: { pathname: "/login", search: "", assign },
      });
      registerApiQueryClient(queryClient);

      await createAuthenticatedBrowserFetch(fetchMock)(path);

      expect(clear).not.toHaveBeenCalled();
      expect(assign).not.toHaveBeenCalled();
    },
  );

  it("passes optional-auth 401 through without cache or redirect effects", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));
    const queryClient = new QueryClient();
    const clear = vi.spyOn(queryClient, "clear");
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: { pathname: "/shared/chat-1", search: "", assign },
    });
    registerApiQueryClient(queryClient);

    const response = await createOptionalAuthFetch(fetchMock)("/auth/v1/me");

    expect(response.status).toBe(401);
    expect(requestFromCall(fetchMock.mock.calls[0]!).credentials).toBe(
      "include",
    );
    expect(clear).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("resolves server paths and preserves request options without browser effects", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));
    const queryClient = new QueryClient();
    const clear = vi.spyOn(queryClient, "clear");
    registerApiQueryClient(queryClient);
    const controller = new AbortController();

    const response = await createServerFetch(fetchMock)("/api/v1/me", {
      headers: { cookie: "llame_session=session-1" },
      cache: "no-store",
      signal: controller.signal,
    });

    const request = requestFromCall(fetchMock.mock.calls[0]!);
    expect(response.status).toBe(401);
    expect(request.url).toBe("https://api.example.com/api/v1/me");
    expect(request.headers.get("cookie")).toBe("llame_session=session-1");
    expect(request.cache).toBe("no-store");
    expect(request.signal.aborted).toBe(false);
    expect(clear).not.toHaveBeenCalled();
    expect(globalThis.window).toBeUndefined();
  });
});
