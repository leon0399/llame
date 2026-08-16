import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { draftChatPath, type DraftPhase } from "./draft-route";
import { fetchDraftChatMessages, fetchInitialChatMessages } from "./server";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

const mockSessionCookie = () => {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn(() => ({ value: "session-token" })),
  } as never);
};

describe("fetchInitialChatMessages", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSessionCookie();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("aborts stalled history reads", async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchInitialChatMessages("chat-1");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/chats/chat-1/messages?limit=100",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );

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
      (_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;

        const response = new Response(null, { status: 200 });
        vi.spyOn(response, "json").mockImplementation(readBody);
        return Promise.resolve(response);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchInitialChatMessages("chat-1").then(
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

    await expect(fetchInitialChatMessages("chat-1")).rejects.toThrow(
      "not-found",
    );
    expect(notFound).toHaveBeenCalledOnce();
  });
});

describe("fetchDraftChatMessages", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSessionCookie();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns null when the owner-scoped draft history is missing", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDraftChatMessages("chat-1", "fresh")).resolves.toBe(null);
  });

  it("calls notFound when a later history page is missing", async () => {
    const firstPageMessages = Array.from({ length: 100 }, (_, index) => ({
      id: `message-${index}`,
      chatId: "chat-1",
      seq: index + 1,
      role: "assistant",
      senderUserId: null,
      parts: [],
      attachments: [],
      usage: null,
      inReplyTo: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ messages: firstPageMessages, compaction: null }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDraftChatMessages("chat-1", "fresh")).rejects.toThrow(
      "not-found",
    );
    expect(notFound).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["fresh", "sent"] satisfies DraftPhase[])(
    "preserves the %s draft route in the login callback on 401",
    async (phase) => {
      const fetchMock = vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response(null, { status: 401 })),
      );
      vi.stubGlobal("fetch", fetchMock);

      const callbackPath = draftChatPath("chat-1", phase);
      await expect(fetchDraftChatMessages("chat-1", phase)).rejects.toThrow(
        `redirect:/login?callbackUrl=${encodeURIComponent(callbackPath)}`,
      );
      expect(redirect).toHaveBeenCalledWith(
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

    await expect(fetchDraftChatMessages("chat-1", "fresh")).resolves.toEqual({
      messages: [],
      compaction: null,
    });
  });
});
