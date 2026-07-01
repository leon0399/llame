import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";

import { fetchInitialChatMessages } from "./server";

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
      "http://localhost:3001/api/v1/chats/chat-1/messages",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );

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
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;

      return Promise.resolve({
        ok: true,
        status: 200,
        json: readBody,
      } as unknown as Response);
    });
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
});
