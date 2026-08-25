import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatHistory } from "@/lib/services/chat/history";
import type { DraftPhase } from "@/lib/services/chat/draft-route";

const mocks = vi.hoisted(() => ({
  fetchDraftChatMessages: vi.fn(),
  fetchInitialChatMessages: vi.fn(),
  seedChatMessagesQueryData: vi.fn(),
}));

vi.mock("@/lib/services/chat/server", () => ({
  fetchDraftChatMessages: mocks.fetchDraftChatMessages,
  fetchInitialChatMessages: mocks.fetchInitialChatMessages,
}));

vi.mock("@/lib/services/chat/queries", () => ({
  seedChatMessagesQueryData: mocks.seedChatMessagesQueryData,
}));

import Page from "./page";

const CHAT_ID = "a5dc235e-1de8-4aad-84d8-e0e247b6a135";
const HISTORY: ChatHistory = { messages: [], compaction: null };

type ChatPageProps = {
  chatId: string;
  initialChatExists: boolean;
  initialDraftPhase: DraftPhase | null;
};

function chatPageProps(element: ReactNode): ChatPageProps {
  if (!isValidElement<{ children: ReactNode }>(element)) {
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

describe("chat route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchInitialChatMessages.mockResolvedValue(HISTORY);
    mocks.fetchDraftChatMessages.mockResolvedValue(HISTORY);
  });

  it.each([undefined, "invalid", ["fresh"]])(
    "strictly loads a route whose draft value is %j",
    async (draft) => {
      const element = await Page({
        params: Promise.resolve({ id: CHAT_ID }),
        searchParams: Promise.resolve({ draft }),
      });

      expect(mocks.fetchInitialChatMessages).toHaveBeenCalledWith(CHAT_ID);
      expect(mocks.fetchDraftChatMessages).not.toHaveBeenCalled();
      expect(mocks.seedChatMessagesQueryData).toHaveBeenCalledWith(
        expect.anything(),
        CHAT_ID,
        HISTORY,
      );
      expect(chatPageProps(element)).toMatchObject({
        chatId: CHAT_ID,
        initialChatExists: true,
        initialDraftPhase: null,
      });
    },
  );

  it.each<DraftPhase>(["fresh", "sent"])(
    "tolerantly loads a %s draft route",
    async (draft) => {
      const element = await Page({
        params: Promise.resolve({ id: CHAT_ID }),
        searchParams: Promise.resolve({ draft }),
      });

      expect(mocks.fetchDraftChatMessages).toHaveBeenCalledWith(CHAT_ID, draft);
      expect(mocks.fetchInitialChatMessages).not.toHaveBeenCalled();
      expect(chatPageProps(element)).toMatchObject({
        chatId: CHAT_ID,
        initialChatExists: true,
        initialDraftPhase: draft,
      });
    },
  );

  it("does not seed a missing fresh draft as persisted history", async () => {
    mocks.fetchDraftChatMessages.mockResolvedValueOnce(null);

    const element = await Page({
      params: Promise.resolve({ id: CHAT_ID }),
      searchParams: Promise.resolve({ draft: "fresh" }),
    });

    expect(mocks.seedChatMessagesQueryData).not.toHaveBeenCalled();
    expect(chatPageProps(element)).toMatchObject({
      chatId: CHAT_ID,
      initialChatExists: false,
      initialDraftPhase: "fresh",
    });
  });
});
