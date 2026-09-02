import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { DehydratedState } from "@tanstack/react-query";

import type { DraftPhase } from "@/lib/services/chat/draft-route";
import { chatQueryKeys } from "@/lib/services/chat/queries";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";

// next/headers and next/navigation are external boundaries (permitted mock
// targets) — server.ts's cookies()/redirect()/notFound() have no in-process
// seam otherwise. Everything else (fetchInitialChatMessages,
// fetchDraftChatMessages, seedChatMessagesQueryData) runs for real against a
// stubbed globalThis.fetch, so this proves the actual request Page() sends
// and the actual query cache it seeds, not an echoed mock.
const { cookiesMock, redirectMock, notFoundMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(async () => ({
    get: () => ({ value: "session-token" }),
  })),
  redirectMock: vi.fn((url: string): never => {
    throw new Error(`redirect:${url}`);
  }),
  notFoundMock: vi.fn((): never => {
    throw new Error("not-found");
  }),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
}));

import Page from "./page";

let fetchMock: Mock<typeof fetch>;

const CHAT_ID = "a5dc235e-1de8-4aad-84d8-e0e247b6a135";
const EMPTY_HISTORY = { messages: [], compaction: null };

type ChatPageProps = {
  chatId: string;
  initialChatExists: boolean;
  initialDraftPhase: DraftPhase | null;
};

function chatPageProps(element: ReactNode): ChatPageProps {
  if (
    !isValidElement<{ children: ReactNode; state: DehydratedState }>(element)
  ) {
    throw new Error("expected hydration boundary");
  }

  // The boundary's children are the pre-hydration pin <script> (#187,
  // prehydration-pin.ts) followed by the chat page — find the page by its
  // props rather than assuming a single child.
  const children = element.props.children;
  const child = (Array.isArray(children) ? children : [children]).find(
    (candidate): candidate is React.ReactElement<ChatPageProps> =>
      isValidElement<Partial<ChatPageProps>>(candidate) &&
      typeof candidate.props.chatId === "string",
  );
  if (child === undefined) {
    throw new Error("expected chat page child");
  }

  return child.props;
}

/** The seeded infinite-query page cache entry for `chatId`, if any. */
function seededMessagesQuery(element: ReactNode, chatId: string) {
  if (!isValidElement<{ state: DehydratedState }>(element)) {
    throw new Error("expected hydration boundary");
  }
  const expectedKey = JSON.stringify(chatQueryKeys.messages(chatId));
  return element.props.state.queries.find(
    (query) => JSON.stringify(query.queryKey) === expectedKey,
  );
}

beforeEach(() => {
  fetchMock = stubFetch();
  cookiesMock.mockClear();
  redirectMock.mockClear();
  notFoundMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat route", () => {
  it.each([undefined, "invalid", ["fresh"]])(
    "strictly loads a route whose draft value is %j",
    async (draft) => {
      fetchMock.mockResolvedValue(jsonResponse(EMPTY_HISTORY));

      const element = await Page({
        params: Promise.resolve({ id: CHAT_ID }),
        searchParams: Promise.resolve({ draft }),
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const request = requestFromCall(fetchMock);
      expect(new URL(request.url).pathname).toBe(
        `/api/v1/chats/${CHAT_ID}/messages`,
      );
      expect(chatPageProps(element)).toMatchObject({
        chatId: CHAT_ID,
        initialChatExists: true,
        initialDraftPhase: null,
      });
      expect(seededMessagesQuery(element, CHAT_ID)?.state.data).toEqual({
        pages: [EMPTY_HISTORY],
        pageParams: [null],
      });
    },
  );

  it("calls notFound (never a graceful null) when the strict path's history 404s", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    await expect(
      Page({
        params: Promise.resolve({ id: CHAT_ID }),
        searchParams: Promise.resolve({ draft: undefined }),
      }),
    ).rejects.toThrow("not-found");
    expect(notFoundMock).toHaveBeenCalledOnce();
  });

  it.each<DraftPhase>(["fresh", "sent"])(
    "tolerantly loads a %s draft route",
    async (draft) => {
      fetchMock.mockResolvedValue(jsonResponse(EMPTY_HISTORY));

      const element = await Page({
        params: Promise.resolve({ id: CHAT_ID }),
        searchParams: Promise.resolve({ draft }),
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const request = requestFromCall(fetchMock);
      expect(new URL(request.url).pathname).toBe(
        `/api/v1/chats/${CHAT_ID}/messages`,
      );
      expect(chatPageProps(element)).toMatchObject({
        chatId: CHAT_ID,
        initialChatExists: true,
        initialDraftPhase: draft,
      });
    },
  );

  it("does not seed a missing fresh draft as persisted history", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    const element = await Page({
      params: Promise.resolve({ id: CHAT_ID }),
      searchParams: Promise.resolve({ draft: "fresh" }),
    });

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(seededMessagesQuery(element, CHAT_ID)).toBeUndefined();
    expect(chatPageProps(element)).toMatchObject({
      chatId: CHAT_ID,
      initialChatExists: false,
      initialDraftPhase: "fresh",
    });
  });
});
