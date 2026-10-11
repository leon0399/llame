import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import type {
  ChatListItemResponse,
  ChatSearchResultResponse,
} from "@/lib/api/generated/models";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";
import { CommandPaletteProvider, useCommandPalette } from "./command-palette";

const PLACEHOLDER = "Search chats, projects, memories…";

function recentChat(
  overrides: Pick<ChatListItemResponse, "id" | "title"> &
    Partial<ChatListItemResponse>,
): ChatListItemResponse {
  return {
    ownerUserId: "user-1",
    visibility: "private",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    projectId: null,
    workspaceRoot: null,
    lastMessage: null,
    ...overrides,
  };
}

function searchResult(
  id: string,
  title: string,
  snippet: string | null = null,
): ChatSearchResultResponse {
  return { id, title, snippet, updatedAt: "" };
}

// No hook mocking: the real chat-list and chat-search queries (and the real
// 300ms debounce) run against a stubbed globalThis.fetch routed by path. The
// search route answers per `q`, so a story can type several terms. An
// unrouted request fails the story.
let fetchMock: Mock<typeof fetch>;

function routeFetch({
  chats = [],
  search = () => [],
}: {
  chats?: Array<ChatListItemResponse>;
  search?: (q: string) => Array<ChatSearchResultResponse>;
}) {
  return () => {
    fetchMock = stubFetch();
    fetchMock.mockImplementation(async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const { pathname, searchParams } = new URL(request.url);
      const key = `${request.method} ${pathname}`;
      if (key === "GET /api/v1/chats/search") {
        return jsonResponse({ results: search(searchParams.get("q") ?? "") });
      }
      if (key === "GET /api/v1/chats") return jsonResponse(chats);
      throw new Error(`unrouted fetch in story: ${key}`);
    });
    return () => {
      vi.unstubAllGlobals();
    };
  };
}

// The palette navigates through the router. nextjs-vite provides
// `useRouter()` from the story's `nextjs.router` parameter, so every
// destination is asserted on this spy.
const routerPush = fn().mockName("router.push");

/** The sidebar's Search button stands in for any `useCommandPalette` caller. */
function Trigger() {
  const palette = useCommandPalette();
  return (
    <button type="button" onClick={() => palette.open()}>
      Search
    </button>
  );
}

/** Open the palette through the trigger, wait for it to finish fading in, and
 *  return its search input. */
async function openPalette(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole("button", { name: "Search" }),
  );
  // The dialog portals into document.body, outside the story canvas.
  const dialog = await screen.findByRole("dialog", { name: "Command palette" });
  await waitFor(() => expect(dialog).toBeVisible());
  return within(dialog).getByPlaceholderText<HTMLInputElement>(PLACEHOLDER);
}

/** Wait until the dialog has finished closing. */
function paletteClosed() {
  return waitFor(() =>
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull(),
  );
}

const meta = {
  component: CommandPaletteProvider,
  tags: ["autodocs"],
  args: { children: <Trigger /> },
  parameters: {
    // The Esc hint and the rows' Chat badge are muted-foreground text on the
    // muted/accent surface, the tracked token contrast defect.
    ...contrastKnownIssue232,
    nextjs: { router: { push: routerPush } },
  },
  beforeEach: () => {
    routerPush.mockClear();
  },
} satisfies Meta<typeof CommandPaletteProvider>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Ctrl+K (⌘K on a Mac) opens the palette from anywhere. A held chord's
 * auto-repeat keydown is ignored, so holding the keys does not flicker the
 * palette open and shut.
 *
 * @summary the keyboard shortcut opens it and ignores auto-repeat
 */
export const KeyboardShortcut: Story = {
  tags: ["ai-generated"],
  beforeEach: routeFetch({}),
  play: async () => {
    await expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();

    // A repeat keydown alone, as the browser sends while the chord is held.
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        repeat: true,
        bubbles: true,
      }),
    );
    // Let React flush anything the keydown scheduled before asserting it
    // opened nothing. (Executor form: this workspace's TS lib predates
    // Promise.withResolvers.)
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();

    await userEvent.keyboard("{Control>}k{/Control}");
    await expect(
      await screen.findByPlaceholderText(PLACEHOLDER),
    ).toBeInTheDocument();
  },
};

/**
 * Opened with nothing typed, the palette offers its two actions next to an Esc
 * hint, and no clear button. Choosing New chat closes it and goes home.
 *
 * @summary the idle palette: actions, Esc hint, New chat goes home
 */
export const Idle: Story = {
  tags: ["ai-generated"],
  beforeEach: routeFetch({}),
  play: async ({ canvasElement }) => {
    await openPalette(canvasElement);
    await expect(screen.getByText("New chat")).toBeVisible();
    await expect(screen.getByText("Settings")).toBeVisible();
    await expect(screen.getByText("Esc")).toBeVisible();
    await expect(
      screen.queryByRole("button", { name: "Clear search" }),
    ).toBeNull();

    await userEvent.click(screen.getByText("New chat"));
    await paletteClosed();
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/"));
  },
};

/**
 * Before anything is typed the palette lists recent chats, each with the same
 * last-message excerpt as the chat list and a Chat badge. Choosing one opens
 * that chat.
 *
 * @summary recent chats at rest, and selecting one opens it
 */
export const RecentChats: Story = {
  tags: ["ai-generated"],
  beforeEach: routeFetch({
    chats: [
      recentChat({
        id: "chat-1",
        title: "Recent chat",
        lastMessage: "how's it going",
      }),
    ],
  }),
  play: async ({ canvasElement }) => {
    await openPalette(canvasElement);

    const row = await screen.findByRole("option", { name: /Recent chat/ });
    await expect(within(row).getByText("how's it going")).toBeVisible();
    await expect(within(row).getByText("Chat")).toBeVisible();

    await userEvent.click(row);
    await paletteClosed();
    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith("/chat/chat-1"),
    );
  },
};

/**
 * Below the content-search length the recent chats are filtered on the
 * client: a one-letter query keeps the chat whose title matches and hides the
 * one that does not.
 *
 * @summary a one-letter query filters recent chats locally
 */
export const ShortQueryFiltersRecentChats: Story = {
  tags: ["ai-generated"],
  beforeEach: routeFetch({
    chats: [
      recentChat({ id: "chat-1", title: "Recent Match" }),
      recentChat({ id: "chat-2", title: "Totally Different" }),
    ],
  }),
  play: async ({ canvasElement }) => {
    const input = await openPalette(canvasElement);
    await screen.findByText("Totally Different");

    // "m" is in "Match" but nowhere in "Totally Different".
    await userEvent.type(input, "m");

    await waitFor(() =>
      expect(screen.queryByText("Totally Different")).toBeNull(),
    );
    await expect(screen.getByText("Recent Match")).toBeVisible();
  },
};

/**
 * Once content search starts, the actions stay searchable: typing "sett"
 * still finds Settings, and choosing it opens the settings page.
 *
 * @summary actions stay searchable while content search runs
 */
export const ActionsDuringSearch: Story = {
  tags: ["ai-generated"],
  beforeEach: routeFetch({}),
  play: async ({ canvasElement }) => {
    const input = await openPalette(canvasElement);
    await userEvent.type(input, "sett");

    await userEvent.click(await screen.findByText("Settings"));
    await paletteClosed();
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/settings"));
  },
};

/**
 * A search lists the server's matches as rows with title, snippet and a Chat
 * badge. Choosing one closes the palette before navigating, so the dialog's
 * closing animation never overlaps the next page. Reopening lands on the
 * same query and results.
 *
 * @summary search results, close-then-navigate, and the kept query
 */
export const SearchResults: Story = {
  tags: ["ai-generated"],
  beforeEach: routeFetch({
    search: (q) =>
      q === "hello" ? [searchResult("chat-1", "My chat", "hello world")] : [],
  }),
  play: async ({ canvasElement }) => {
    const input = await openPalette(canvasElement);
    await userEvent.type(input, "hello");

    const row = await screen.findByRole("option", { name: /My chat/ });
    await expect(within(row).getByText("hello world")).toBeVisible();
    await expect(within(row).getByText("Chat")).toBeVisible();

    await userEvent.click(row);
    // Navigation waits out the close animation: nothing is pushed yet.
    await expect(routerPush).not.toHaveBeenCalled();
    await paletteClosed();
    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith("/chat/chat-1"),
    );

    // Reopening resumes the same search, so the next result is one click away.
    const reopened = await openPalette(canvasElement);
    await expect(reopened).toHaveValue("hello");
    await expect(await screen.findByText("My chat")).toBeVisible();
  },
};

/**
 * A clear button appears once a query is typed and empties the input.
 *
 * @summary the clear button empties the query
 */
export const ClearSearch: Story = {
  tags: ["ai-generated"],
  beforeEach: routeFetch({}),
  play: async ({ canvasElement }) => {
    const input = await openPalette(canvasElement);
    await userEvent.type(input, "hello");

    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));

    await expect(input).toHaveValue("");
    await expect(
      screen.queryByRole("button", { name: "Clear search" }),
    ).toBeNull();
  },
};

const serverMatches: Array<{ query: string; title: string; snippet?: string }> =
  [
    // The term appears only in message content the server searched, never in
    // the title or snippet the palette shows (#171).
    {
      query: "quarterly",
      title: "Meeting Notes",
      snippet: "budget discussion",
    },
    {
      query: "квартальный",
      title: "Заметки о встрече",
      snippet: "обсуждение бюджета",
    },
    // A whole title typed in lowercase, Latin and Cyrillic.
    { query: "redis migration notes", title: "Redis Migration Notes" },
    { query: "тестовый чат", title: "Тестовый Чат" },
  ];

/**
 * Every chat the server matched is listed, even when the query appears only
 * in message content the palette never shows, and regardless of case or
 * script (#171).
 *
 * @summary server matches are shown as-is, content-only ones included
 */
export const ServerMatchesShown: Story = {
  tags: ["ai-generated"],
  beforeEach: routeFetch({
    // Neutral ids: an item's id is part of the value cmdk would match against,
    // so an id spelling the query would let a client-side filter find it too.
    search: (q) =>
      serverMatches.flatMap((match, index) =>
        match.query === q
          ? [searchResult(`chat-${index + 1}`, match.title, match.snippet)]
          : [],
      ),
  }),
  play: async ({ canvasElement }) => {
    const input = await openPalette(canvasElement);
    for (const { query, title } of serverMatches) {
      await userEvent.clear(input);
      await userEvent.type(input, query);
      await expect(await screen.findByText(title)).toBeVisible();
    }
  },
};

/**
 * Results keep the server's order. For "ab" a client-side fuzzy ranking would
 * put "Ab Testing Plan" first; the server ranked "Database AB Migration"
 * first, and the palette shows them that way.
 *
 * @summary results keep the server's order
 */
export const ServerOrderKept: Story = {
  tags: ["ai-generated"],
  beforeEach: routeFetch({
    search: () => [
      searchResult("chat-b", "Database AB Migration"),
      searchResult("chat-a", "Ab Testing Plan"),
    ],
  }),
  play: async ({ canvasElement }) => {
    const input = await openPalette(canvasElement);
    await userEvent.type(input, "ab");

    await screen.findByText("Database AB Migration");
    const chats = screen.getByRole("group", { name: "Chats" });
    const titles = within(chats)
      .getAllByRole("option")
      .map((option) => option.textContent);
    await expect(titles).toEqual([
      "Database AB MigrationChat",
      "Ab Testing PlanChat",
    ]);
  },
};
