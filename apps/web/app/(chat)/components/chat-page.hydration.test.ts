import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

const readRepoFile = (path: string) =>
  readFileSync(join(repoRoot, path), "utf8");

describe("ChatPage hydration", () => {
  it("keeps the draft chat id independent from persisted route ids", () => {
    const source = readRepoFile("apps/web/app/(chat)/components/chat-page.tsx");

    expect(source).toMatch(
      /const\s+\[newChatId\]\s*=\s*useState\(safeRandomUUID\)/,
    );
    expect(source).not.toMatch(/persistedChatId\s*\?\?\s*safeRandomUUID\(/);
  });

  it("routes server-provided history through the chat messages React Query cache", () => {
    const source = readRepoFile("apps/web/app/(chat)/components/chat-page.tsx");

    expect(source).toMatch(/useChatMessagesQuery\(\s*{/);
    expect(source).not.toMatch(/messages\s*:\s*initialMessages\s*,/);
  });

  it("does not mount the chat message query for draft sessions", () => {
    const source = readRepoFile("apps/web/app/(chat)/components/chat-page.tsx");
    const draftSession = source.slice(
      source.indexOf("function DraftChatSession"),
      source.indexOf("function PersistedChatSession"),
    );
    const persistedSession = source.slice(
      source.indexOf("function PersistedChatSession"),
      source.indexOf("function ChatSessionContent"),
    );

    // Fresh drafts (not rehydrated from the per-tab store) must take the
    // draft mount path — the guard shape the restructure introduced (#49).
    expect(source).toMatch(/navigateOnFinish && !rehydratedDraft/);
    expect(source).toMatch(/<DraftChatSession\b/);
    expect(source).toMatch(/<PersistedChatSession\b/);
    expect(draftSession).not.toMatch(/useChatMessagesQuery/);
    expect(persistedSession).toMatch(/useChatMessagesQuery\(\s*{/);
    expect(persistedSession).not.toMatch(/seedChatMessagesQueryData/);
  });

  it("hydrates the chat message query from the server page", () => {
    const source = readRepoFile("apps/web/app/(chat)/chat/[id]/page.tsx");

    expect(source).toMatch(/new QueryClient\(\)/);
    expect(source).toMatch(
      /seedChatMessagesQueryData\(queryClient,\s*id,\s*initialMessages\)/,
    );
    expect(source).toMatch(
      /<HydrationBoundary state={dehydrate\(queryClient\)}>/,
    );
    expect(source).not.toMatch(/initialMessages={initialMessages}/);
  });
});
