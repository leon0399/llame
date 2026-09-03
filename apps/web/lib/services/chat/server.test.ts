import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { draftChatPath, type DraftPhase } from "./draft-route";
import { rawChatMessage } from "./message-fixtures";
import { fetchDraftChatMessages, fetchInitialChatMessages } from "./server";

// Injected in place of the next/headers and next/navigation modules
// (server.ts's `deps` parameter, defaulted to the real Next APIs) — these
// fakes are real, faithful implementations of the same call contract:
// notFound()/redirect() always throw, exactly like the framework originals.
function fakeDeps(overrides?: { hasSessionCookie?: boolean }) {
  const hasSessionCookie = overrides?.hasSessionCookie ?? true;

  return {
    cookies: vi.fn(async () => ({
      get: () => (hasSessionCookie ? { value: "session-token" } : undefined),
    })),
    redirect: vi.fn((url: string): never => {
      throw new Error(`redirect:${url}`);
    }),
    notFound: vi.fn((): never => {
      throw new Error("not-found");
    }),
  };
}

describe("fetchInitialChatMessages", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts stalled history reads", async () => {
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const request =
            input instanceof Request ? input : new Request(input, init);
          request.signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchInitialChatMessages("chat-1", fakeDeps());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [request] = fetchMock.mock.calls[0]!;
    if (!(request instanceof Request)) {
      throw new Error("expected fetch to receive a Request");
    }
    expect(request.url).toBe(
      "http://localhost:3001/api/v1/chats/chat-1/messages?limit=100",
    );
    expect(request.signal).toBeInstanceOf(AbortSignal);

    // Constructed (not awaited) before advancing timers so the rejection
    // handler attaches before the abort fires — awaiting inline here would
    // race the fake-timer advance below and risk an unhandled rejection.
    // oxlint-disable-next-line vitest/valid-expect
    const expectedAbort = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(5000);
    await expectedAbort;
  });

  it("keeps the timeout active while reading the history body", async () => {
    let requestSignal: AbortSignal | undefined;
    const readBody = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          requestSignal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const fetchMock = vi.fn<typeof fetch>(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        requestSignal = request.signal;

        const response = new Response(null, { status: 200 });
        vi.spyOn(response, "text").mockImplementation(readBody);
        return Promise.resolve(response);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchInitialChatMessages("chat-1", fakeDeps()).then(
      () => "resolved",
      (error: unknown) =>
        error instanceof DOMException ? error.name : "rejected",
    );
    await vi.waitFor(() => expect(readBody).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(5000);
    await expect(
      Promise.race([result, Promise.resolve("pending")]),
    ).resolves.toBe("AbortError");
  });

  it("calls notFound for a missing initial history page", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const deps = fakeDeps();

    await expect(fetchInitialChatMessages("chat-1", deps)).rejects.toThrow(
      "not-found",
    );
    expect(deps.notFound).toHaveBeenCalledOnce();
  });
});

describe("fetchDraftChatMessages", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns null when the owner-scoped draft history is missing", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchDraftChatMessages("chat-1", "fresh", fakeDeps()),
    ).resolves.toBe(null);
  });

  it("fetches only the newest page, even when the chat has more (#187)", async () => {
    // A FULL page means older history exists — SSR must still stop at one
    // round trip; older pages load on demand from the client-side query.
    const firstPageMessages = Array.from({ length: 100 }, (_, index) =>
      rawChatMessage({ id: `message-${index}`, seq: index + 101 }),
    );
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ messages: firstPageMessages, compaction: null }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await fetchDraftChatMessages("chat-1", "fresh", fakeDeps());

    expect(page?.messages).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["fresh", "sent"] satisfies Array<DraftPhase>)(
    "preserves the %s draft route in the login callback on 401",
    async (phase) => {
      const fetchMock = vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response(null, { status: 401 })),
      );
      vi.stubGlobal("fetch", fetchMock);
      const deps = fakeDeps();

      const callbackPath = draftChatPath("chat-1", phase);
      await expect(
        fetchDraftChatMessages("chat-1", phase, deps),
      ).rejects.toThrow(
        `redirect:/login?callbackUrl=${encodeURIComponent(callbackPath)}`,
      );
      expect(deps.redirect).toHaveBeenCalledWith(
        `/login?callbackUrl=${encodeURIComponent(callbackPath)}`,
      );
    },
  );

  it("returns an empty history when the draft exists without messages", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ messages: [], compaction: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchDraftChatMessages("chat-1", "fresh", fakeDeps()),
    ).resolves.toEqual({
      messages: [],
      compaction: null,
    });
  });

  it("redirects to login when no session cookie is present", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const deps = fakeDeps({ hasSessionCookie: false });

    const callbackPath = draftChatPath("chat-1", "fresh");
    await expect(
      fetchDraftChatMessages("chat-1", "fresh", deps),
    ).rejects.toThrow(
      `redirect:/login?callbackUrl=${encodeURIComponent(callbackPath)}`,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
