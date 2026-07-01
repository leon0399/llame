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

    expect(source).toContain("const [newChatId] = useState(safeRandomUUID);");
    expect(source).not.toContain("persistedChatId ?? safeRandomUUID()");
  });

  it("routes server-provided history through the chat messages React Query cache", () => {
    const source = readRepoFile("apps/web/app/(chat)/components/chat-page.tsx");

    expect(source).toContain("useChatMessagesQuery({");
    expect(source).toContain("initialMessages,");
    expect(source).not.toContain("messages: initialMessages,");
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

    expect(source).toContain("navigateOnFinish ? (");
    expect(source).toContain("<DraftChatSession");
    expect(source).toContain("<PersistedChatSession");
    expect(draftSession).not.toContain("useChatMessagesQuery");
    expect(persistedSession).toContain("useChatMessagesQuery({");
  });
});
