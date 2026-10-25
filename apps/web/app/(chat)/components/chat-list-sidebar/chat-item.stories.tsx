import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";
import { SidebarMenu, SidebarProvider } from "@workspace/ui/components/sidebar";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

// Import the mocked context via the REAL specifier (not the __mocks__ file
// directly): sb.mock (preview.tsx) redirects it to the mock, so overriding
// `useActiveRuns.mockReturnValue(...)` here affects the SAME instance the
// component reads (a direct __mocks__ import is a separate module instance, so
// the override would never reach the component and the status dot never shows).
import * as activeRunsContext from "@/contexts/active-runs-context";
import { emptyActiveRuns } from "@/contexts/__mocks__/active-runs-context";
// Import the pins hooks via the REAL specifier: sb.mock (preview.tsx) redirects
// them to the __mocks__ module. The stable `pinMutate`/`unpinMutate` controls
// are imported from that manual mock and injected into the redirected hooks in
// `beforeEach`.
import * as pinsMutations from "@/lib/services/pins/mutations";
import {
  pinMutate,
  unpinMutate,
} from "@/lib/services/pins/__mocks__/mutations";
// Same for the fork mutation: sb.mock redirects the real specifier to the
// manual mock exposing the stable `forkMutate` control.
import * as fork from "@/lib/services/chat/fork";
import { forkMutate } from "@/lib/services/chat/__mocks__/fork";
import type { ChatResponse } from "@/lib/services/chat/queries";
import type { CheckoutResponse } from "@/lib/services/checkouts/queries";
import type { ProjectResponse } from "@/lib/services/project/types";
import {
  emptyResponse,
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";
import { ChatItem } from "./chat-item";

// The real-specifier hooks are redirected to Storybook mocks. Injecting the
// typed control spy keeps the component and story on the same call instance.
const usePinItem = vi.mocked(pinsMutations.usePinItem, { partial: true });
const useUnpinItem = vi.mocked(pinsMutations.useUnpinItem, { partial: true });
const useForkChat = vi.mocked(fork.useForkChat, { partial: true });
const useActiveRuns = vi.mocked(activeRunsContext.useActiveRuns, {
  partial: true,
});

// The row's whole-chat fork opens the copy through the router. nextjs-vite
// provides `useRouter()` from the story's own `nextjs.router` parameter, so a
// story can hand the framework this spy and then assert the destination.
const routerPush = fn().mockName("router.push");

// Filing runs the REAL useFileChat — no module mock — against a stubbed
// globalThis.fetch, so a pick is proved by the request it actually sends. The
// chat's PATCH is the only routed request. Any other request is recorded and
// the meta's afterEach fails the story on it: the throw alone would only reach
// useFileChat's onError toast.
let fetchMock: Mock<typeof fetch>;
let unrouted: Array<string> = [];

function routeFileChat() {
  fetchMock = stubFetch();
  unrouted = [];
  fetchMock.mockImplementation((input) => {
    const request = input instanceof Request ? input : new Request(input);
    const key = `${request.method} ${new URL(request.url).pathname}`;
    if (key === "PATCH /api/v1/chats/chat-1") {
      return Promise.resolve(emptyResponse());
    }
    unrouted.push(key);
    throw new Error(`unrouted fetch in story: ${key}`);
  });
  return () => {
    vi.unstubAllGlobals();
  };
}

/** "METHOD /path" of every request sent so far, in order. */
function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => {
    const request = input instanceof Request ? input : new Request(input);
    return `${request.method} ${new URL(request.url).pathname}`;
  });
}

// The bound chat a "New chat here" story opens on: its Workspace root and the
// catalog row that root maps back onto.
const BOUND_ROOT = "/repos/acme";

const boundCheckouts: Array<CheckoutResponse> = [
  {
    id: "co-1",
    repositoryId: "repo-1",
    executorId: "exec-1",
    path: BOUND_ROOT,
    kind: "main",
    parentCheckoutId: null,
    branch: "master",
    origin: "registered",
    worktreeBase: null,
    chatIds: ["chat-1"],
    leaseChatId: null,
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
  },
];

/**
 * Stub `fetch` so the row's checkout read is the only routed request. The
 * handler decides the shape the read sees: a resolved list, or a request that
 * never settles so the query stays pending.
 */
function routeCheckouts(handler: () => Promise<Response>) {
  fetchMock = stubFetch();
  unrouted = [];
  fetchMock.mockImplementation((input) => {
    const request = input instanceof Request ? input : new Request(input);
    const key = `${request.method} ${new URL(request.url).pathname}`;
    if (key === "GET /api/v1/checkouts") return handler();
    unrouted.push(key);
    throw new Error(`unrouted fetch in story: ${key}`);
  });
  return () => {
    vi.unstubAllGlobals();
  };
}

/** Opens the row menu, then its project submenu by the trigger's label. */
async function openProjectSubmenu(
  canvasElement: HTMLElement,
  trigger: "Add to project" | "Change project",
) {
  await userEvent.click(
    within(canvasElement).getByRole("button", { name: /more/i }),
  );
  // Radix menus portal to the document body — query from screen, not canvas.
  await userEvent.hover(await screen.findByRole("menuitem", { name: trigger }));
}

/** Picks a project in the open submenu; returns the one request it sent. */
async function pickProject(name: string) {
  await userEvent.click(await screen.findByRole("menuitemradio", { name }));
  const request = await waitFor(() => requestFromCall(fetchMock));
  // One pick, one request: the chat's own PATCH and nothing else.
  await expect(sentRoutes()).toEqual(["PATCH /api/v1/chats/chat-1"]);
  return request;
}

// Separate guard rather than an inline `typeof`: the mutation's success
// callback is destructured from a mock call, and the repo forbids runtime
// typeof outside a type guard.
function isForkCallback(
  value: unknown,
): value is (forked: { id: string }) => void {
  return typeof value === "function";
}

const baseChat: ChatResponse = {
  id: "chat-1",
  title: "Acme relaunch plan",
  lastMessage: "The todos are on the project — want me to draft the IA next?",
  visibility: "private",
  projectId: null,
  workspaceRoot: null,
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T10:00:00.000Z",
  archivedAt: null,
};

// Same literal the row renders for an untitled chat, kept local per this
// repo's per-render-site convention.
const UNTITLED_CHAT_LABEL = "New chat";

// Comfortably wider than the 17rem rail, so the fade + hover scroll have
// something to work with.
const LONG_TITLE =
  "Migrating the billing service off the legacy scheduler without downtime";

const projects: Array<ProjectResponse> = [
  {
    id: "p1",
    ownerUserId: "u1",
    name: "Work",
    description: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
    defaultExecutorId: null,
  },
  {
    id: "p2",
    ownerUserId: "u1",
    name: "Research",
    description: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
    defaultExecutorId: null,
  },
];

const meta = {
  component: ChatItem,
  tags: ["autodocs"],
  args: {
    chat: baseChat,
    isActive: false,
    isPinned: false,
    projects: [],
  },
  // The mocked activity is ID-KEYED, not per-story state: only
  // "chat-processing", "chat-unread" and "chat-failed" carry a dot. This is stable across every story, so on the
  // autodocs page (where all stories co-render and share the one module-level
  // useActiveRuns spy) each row shows the status matching ITS OWN chat.id —
  // Basic ("chat-1") stays clean instead of inheriting a status story's state.
  beforeEach: () => {
    useActiveRuns.mockReturnValue({
      ...emptyActiveRuns(),
      activeChatIds: new Set(["chat-processing"]),
      unseenRunOutcomes: new Map([
        ["chat-unread", "completed"],
        ["chat-failed", "failed"],
      ]),
    });
    usePinItem.mockReturnValue({ mutate: pinMutate, isPending: false });
    pinMutate.mockClear();
  },
  afterEach: async () => {
    const leaked = unrouted;
    unrouted = [];
    await expect(leaked).toEqual([]);
  },
  decorators: [
    (Story) => (
      // Width-only frame matching the chats secondary menu's harness
      // (SidebarProvider → SidebarMenu). The row stays transparent and shows
      // only its own hover/active states; min-h-0 w-fit stops SidebarProvider's
      // min-h-svh/w-full from inflating the canvas.
      <SidebarProvider className="min-h-0 w-fit">
        <div className="w-68 p-2">
          <SidebarMenu>
            <Story />
          </SidebarMenu>
        </div>
      </SidebarProvider>
    ),
  ],
  parameters: { layout: "centered" },
} satisfies Meta<typeof ChatItem>;

export default meta;
type Story = StoryObj<typeof meta>;

// Radix dropdown/submenu portals produce vendored-structure axe false positives
// (documented in packages/ui/AGENTS.md): the open menu toggles aria-hidden on
// background siblings that still contain focusable content
// (aria-hidden-focus), and the searchable move-to-project submenu nests an
// input + button under role=menu (aria-required-children). Disable ONLY those
// two rules for the menu-open stories; every other a11y rule still runs.
const menuPortalA11y = {
  a11y: {
    config: {
      rules: [
        { id: "aria-hidden-focus", enabled: false },
        { id: "aria-required-children", enabled: false },
      ],
    },
  },
};

/**
 * The default chat row: icon, title, and last-message excerpt, with the pin +
 * kebab controls revealed on hover — and no activity dot, since chat-1 is
 * neither generating nor carrying an unseen reply (see the meta `beforeEach`).
 *
 * @summary the default two-line chat row, with no activity dot
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByLabelText("Generating response")).toBeNull();
    await expect(canvas.queryByLabelText("Unread reply")).toBeNull();
  },
};

/**
 * The row for the chat currently open — highlighted, and its kebab stays
 * visible without hover (as in the live list).
 *
 * @summary the selected/open chat row
 */
export const Active: Story = {
  args: { isActive: true },
  // #232 — on the active row's accent surface the muted-foreground excerpt is
  // ~4.34:1, the tracked low-contrast token defect. Suppress only
  // color-contrast until the token fix lands.
  parameters: { ...contrastKnownIssue232 },
  tags: ["ai-generated"],
};

/**
 * A run is generating a reply for this chat: a spinner dot sits on the icon.
 *
 * @summary chat with an in-flight run (processing dot)
 */
export const Processing: Story = {
  // "chat-processing" is the id the meta beforeEach marks active.
  args: { chat: { ...baseChat, id: "chat-processing" } },
  tags: ["ai-generated"],
  // The "Generating response" indicator spins continuously, so a screenshot
  // captures a nondeterministic frame; skip screenshot capture (play still runs).
  parameters: { visualTests: { disable: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByLabelText("Generating response"),
    ).toBeInTheDocument();
  },
};

/**
 * A background run finished while the user was elsewhere: an unread dot marks
 * the chat until it's opened.
 *
 * @summary chat with an unseen completed reply (unread dot)
 */
export const Unread: Story = {
  // "chat-unread" is the id the meta beforeEach marks completed-but-unseen.
  args: { chat: { ...baseChat, id: "chat-unread" } },
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Unread reply")).toBeInTheDocument();
  },
};

/**
 * A background run failed while the user was elsewhere: a red dot marks the
 * chat until it's opened.
 *
 * @summary chat with an unseen failed run (failed dot)
 */
export const Failed: Story = {
  // "chat-failed" is the id the meta beforeEach marks failed-but-unseen.
  args: { chat: { ...baseChat, id: "chat-failed" } },
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Run failed")).toBeInTheDocument();
    await expect(canvas.queryByLabelText("Unread reply")).toBeNull();
  },
};

/**
 * A pinned chat: the pin control stays visible (filled) even without hover, so
 * the pinned state is legible at rest — and, being in layout, it is clickable
 * as it stands: selecting it unpins the chat through the unified pins resource.
 * It sits at the row's edge because the hidden kebab occupies no width at all,
 * and slides over as the kebab takes its own width on hover.
 *
 * @summary a pinned chat row whose visible pin control unpins it
 */
export const Pinned: Story = {
  args: { isPinned: true },
  tags: ["ai-generated"],
  // Runs after meta.beforeEach, so this override wins for this story only.
  beforeEach: () => {
    unpinMutate.mockClear();
    useUnpinItem.mockReturnValue({ mutate: unpinMutate, isPending: false });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Unpin" }));

    // The unpin names the same unified-resource key the pin does: itemType +
    // itemId, and nothing else.
    await expect(unpinMutate).toHaveBeenCalledTimes(1);
    await expect(unpinMutate).toHaveBeenCalledWith({
      itemType: "chat",
      itemId: "chat-1",
    });
  },
};

/**
 * Keyboard reach: the row itself is a link, so Tab lands on it and Enter opens
 * the chat before Tab ever reaches the actions — and focus reveals those
 * actions, so what is reachable is also visible.
 *
 * @summary the row is reachable and openable by keyboard
 */
export const KeyboardAccess: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step("Tab reaches the row before its actions", async () => {
      await userEvent.tab();
      const link = canvas.getByRole("link");
      await expect(link).toHaveFocus();
      await expect(link).toHaveAttribute("href", "/chat/chat-1");
    });

    await step("then the row's own actions, in order", async () => {
      await userEvent.tab();
      await expect(canvas.getByRole("button", { name: "Pin" })).toHaveFocus();
      await userEvent.tab();
      await expect(canvas.getByRole("button", { name: /more/i })).toHaveFocus();
    });
  },
};

/**
 * A chat whose name is still being generated: the placeholder shimmers, so it
 * reads as work in progress rather than as the chat's actual title. Both
 * conditions matter — an untitled chat with no run in flight stays plain.
 *
 * @summary the untitled placeholder while a run is producing a name
 */
export const UntitledProcessing: Story = {
  // "chat-processing" is the id the meta beforeEach marks active.
  args: { chat: { ...baseChat, id: "chat-processing", title: null } },
  tags: ["ai-generated"],
  // The sweep loops continuously, so a screenshot lands on a random frame.
  parameters: { visualTests: { disable: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(UNTITLED_CHAT_LABEL)).toHaveClass("shimmer");
  },
};

/**
 * The moment a generated name lands on a row that was showing the placeholder:
 * the old text deletes and the new one types in, so the name reads as authored
 * rather than swapped. Any later change (a rename) animates the same way.
 *
 * @summary a title being retyped as it changes
 */
export const TitleArrives: Story = {
  tags: ["ai-generated"],
  // Mid-typing frames are nondeterministic by construction.
  parameters: { visualTests: { disable: true } },
  render: function TitleArrivesRender(args) {
    const [title, setTitle] = useState<string | null>(null);

    useEffect(() => {
      const timer = setTimeout(() => setTitle(LONG_TITLE), 600);
      return () => clearTimeout(timer);
    }, []);

    return <ChatItem {...args} chat={{ ...args.chat, title }} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Starts on the placeholder, then types its way to the whole title. The
    // wait covers the 600ms trigger plus the typing itself, which is capped at
    // 1200ms — comfortably past testing-library's 1s default.
    await expect(canvas.getByText(UNTITLED_CHAT_LABEL)).toBeInTheDocument();
    await expect(
      await canvas.findByText(LONG_TITLE, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
  },
};

/**
 * A title too long for the row: it fades out instead of taking an ellipsis
 * (the row can reveal the rest — hovering scrolls it to its end), while the
 * excerpt below keeps its ellipsis (the rest of that message belongs to the
 * chat, not to this row). See DESIGN.md §3, "Overflow".
 *
 * @summary a chat row whose title is faded and scrollable, not ellipsed
 */
export const LongTitle: Story = {
  args: { chat: { ...baseChat, title: LONG_TITLE } },
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The full title is carried as a native tooltip only while the row hides
    // part of it at rest — written from the ResizeObserver, so it lands a beat
    // after render.
    const clipped = await canvas.findByTitle(LONG_TITLE);
    await expect(clipped).toHaveAttribute("data-clipped", "true");
    // Measured from the live box: how far row hover scrolls the title, and how
    // long that takes at the design's reading speed.
    const style = clipped.getAttribute("style") ?? "";
    await expect(style).toMatch(/--marquee-x:\s*-\d+px/);
    await expect(style).toMatch(/--marquee-ms:\s*\d+ms/);
  },
};

/**
 * An archived chat (surfaces in the Pinned section, which includes archived
 * pins): the "Archived" pill sits beside a de-emphasized title and dimmed icon.
 *
 * @summary an archived chat row with the Archived pill + de-emphasis
 */
export const Archived: Story = {
  args: { chat: { ...baseChat, archivedAt: "2026-07-19T09:00:00.000Z" } },
  // #232 — the Archived pill is muted-foreground on the secondary surface
  // (~4.34:1), the tracked low-contrast token defect. Suppress only
  // color-contrast until the token fix lands.
  parameters: { ...contrastKnownIssue232 },
  tags: ["ai-generated"],
};

/**
 * An archived chat that is also pinned — the state a Pinned-section archived
 * row actually renders in.
 *
 * @summary archived + pinned chat row
 */
export const ArchivedPinned: Story = {
  args: {
    chat: { ...baseChat, archivedAt: "2026-07-19T09:00:00.000Z" },
    isPinned: true,
  },
  parameters: { ...contrastKnownIssue232 }, // #232, see Archived
  tags: ["ai-generated"],
};

/**
 * Pinning requests a pin through the unified pins resource, synthesizing a card
 * from the on-screen chat so the rail can render it before the server responds.
 * Both entry points do it: the always-available quick control on the row and
 * the row menu's Pin item.
 *
 * @summary both Pin controls fire the pin mutation with a synthesized card
 */
export const Pin: Story = {
  parameters: { ...menuPortalA11y },
  tags: ["ai-generated"],
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    // The card the row synthesizes from the chat already on screen.
    const synthesizedCard = {
      id: "chat-1",
      title: "Acme relaunch plan",
      archivedAt: null,
    };

    await step("the row's quick pin control pins the chat", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Pin" }));
      await expect(pinMutate).toHaveBeenCalledTimes(1);
      await expect(pinMutate).toHaveBeenCalledWith({
        itemType: "chat",
        itemId: "chat-1",
        card: synthesizedCard,
      });
    });

    await step("the menu's Pin item does the same", async () => {
      pinMutate.mockClear();
      await userEvent.click(canvas.getByRole("button", { name: /more/i }));
      // Radix menus portal to the document body — query from screen, not canvas.
      await userEvent.click(
        await screen.findByRole("menuitem", { name: "Pin" }),
      );
      await expect(pinMutate).toHaveBeenCalledTimes(1);
      await expect(pinMutate).toHaveBeenCalledWith({
        itemType: "chat",
        itemId: "chat-1",
        card: synthesizedCard,
      });
    });
  },
};

/**
 * The "…" row menu opened — pin, rename, move-to-project, share/export/fork, and
 * the archive/delete lifecycle, grouped by semantics.
 *
 * @summary the row menu open, showing every action
 */
export const RowMenu: Story = {
  args: { projects },
  parameters: { ...menuPortalA11y },
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /more/i }));
    // Radix menus portal to the document body — scope to the open menu and
    // assert presence (toBeVisible races the open animation).
    const menu = await screen.findByRole("menu");
    await expect(
      within(menu).getByRole("menuitem", { name: "Rename" }),
    ).toBeInTheDocument();
    await expect(
      within(menu).getByRole("menuitem", { name: "Fork" }),
    ).toBeInTheDocument();
  },
};

/**
 * Selecting Fork clones the WHOLE chat — no fork-point message, unlike the
 * per-message "fork from here" action — and opens the copy once the server
 * returns it.
 *
 * @summary the Fork item clones the chat and opens the copy
 */
export const Fork: Story = {
  // nextjs-vite resolves useRouter() from this parameter, so the push the row
  // performs on success is observable here.
  parameters: {
    ...menuPortalA11y,
    nextjs: { router: { push: routerPush } },
  },
  tags: ["ai-generated"],
  // Runs after meta.beforeEach, so this override wins for this story only.
  beforeEach: () => {
    forkMutate.mockClear();
    routerPush.mockClear();
    useForkChat.mockReturnValue({ mutate: forkMutate, isPending: false });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /more/i }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Fork" }),
    );

    // Direct call inspection instead of expect.any(Function): browser-mode
    // matchers instanceof-check against the wrong realm's Function.
    // SAFETY: forkChatHandler always calls `mutate` with these two positional
    // arguments — asserted immediately below by shape and type.
    const [variables, { onSuccess }] = forkMutate.mock.calls[0] as [
      { chatId: string },
      { onSuccess: (forked: { id: string }) => void },
    ];
    // The clone carries no anchor message: that is the difference between the
    // whole-chat Fork and the per-message action's fromMessageId.
    await expect(forkMutate).toHaveBeenCalledTimes(1);
    await expect(variables).toEqual({ chatId: "chat-1" });
    await expect(isForkCallback(onSuccess)).toBe(true);

    // Driving the mutation's success opens the new chat.
    onSuccess({ id: "forked-chat-9" });
    await expect(routerPush).toHaveBeenCalledWith("/chat/forked-chat-9");
  },
};

/**
 * The move-to-project submenu is a searchable radio list: typing narrows the
 * projects (client-side filter over the caller's project list), a query that
 * matches nothing says so instead of emptying the list, and the field's clear
 * affordance brings the full list back.
 *
 * @summary filtering the move-to-project submenu: narrowing, empty, clear
 */
export const ProjectMenuFilter: Story = {
  args: { projects },
  parameters: { ...menuPortalA11y },
  tags: ["ai-generated"],
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /more/i }));
    await userEvent.hover(
      await screen.findByRole("menuitem", { name: "Add to project" }),
    );
    const filter = await screen.findByPlaceholderText("Search projects…");

    await step("typing narrows the list to matching projects", async () => {
      await userEvent.type(filter, "res");
      await expect(
        await screen.findByRole("menuitemradio", { name: "Research" }),
      ).toBeInTheDocument();
      await expect(
        screen.queryByRole("menuitemradio", { name: "Work" }),
      ).toBeNull();
    });

    await step("a query matching nothing says so", async () => {
      await userEvent.type(filter, "zzz");
      await expect(
        await screen.findByText("No projects found"),
      ).toBeInTheDocument();
      await expect(screen.queryByRole("menuitemradio")).toBeNull();
    });

    await step("clearing the field brings the full list back", async () => {
      await userEvent.click(
        screen.getByRole("button", { name: "Clear search" }),
      );
      await expect(
        await screen.findByRole("menuitemradio", { name: "Work" }),
      ).toBeInTheDocument();
      await expect(
        screen.queryByRole("button", { name: "Clear search" }),
      ).toBeNull();
    });
  },
};

/**
 * A chat already in a project: the submenu trigger reads "Change project" and
 * the current project carries the radio check, so the submenu also shows where
 * the chat is now, not just where it could go.
 *
 * @summary the move-to-project submenu of a filed chat
 */
export const ProjectMenuFiled: Story = {
  args: { chat: { ...baseChat, projectId: "p1" }, projects },
  parameters: { ...menuPortalA11y },
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /more/i }));
    await userEvent.hover(
      await screen.findByRole("menuitem", { name: "Change project" }),
    );

    await expect(
      await screen.findByRole("menuitemradio", { name: "Work" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      screen.getByRole("menuitemradio", { name: "Research" }),
    ).toHaveAttribute("aria-checked", "false");
    // Unfiling is re-picking the checked project (the radio group's toggle-off),
    // so there is deliberately no separate "Remove from project" item.
    await expect(
      screen.queryByRole("menuitem", { name: /remove from project/i }),
    ).toBeNull();
  },
};

/**
 * Picking a project in an unfiled chat's submenu files the chat into it: the
 * row sends the chat's own update carrying the picked project.
 *
 * @summary picking a project files an unfiled chat into it
 */
export const ProjectMenuFile: Story = {
  args: { projects },
  parameters: { ...menuPortalA11y },
  tags: ["ai-generated"],
  beforeEach: routeFileChat,
  play: async ({ canvasElement }) => {
    await openProjectSubmenu(canvasElement, "Add to project");

    const request = await pickProject("Research");
    await expect(request.clone().json()).resolves.toEqual({
      projectId: "p2",
    });
  },
};

/**
 * Picking a different project in a filed chat's submenu moves the chat there —
 * one update naming the new project, not an unfile followed by a file.
 *
 * @summary picking another project moves a filed chat
 */
export const ProjectMenuRefile: Story = {
  args: { chat: { ...baseChat, projectId: "p1" }, projects },
  parameters: { ...menuPortalA11y },
  tags: ["ai-generated"],
  beforeEach: routeFileChat,
  play: async ({ canvasElement }) => {
    await openProjectSubmenu(canvasElement, "Change project");

    const request = await pickProject("Research");
    await expect(request.clone().json()).resolves.toEqual({
      projectId: "p2",
    });
  },
};

/**
 * Re-picking the checked project is how a chat leaves its project: the update
 * clears the project rather than re-sending the current one.
 *
 * @summary re-picking the checked project unfiles the chat
 */
export const ProjectMenuUnfile: Story = {
  args: { chat: { ...baseChat, projectId: "p1" }, projects },
  parameters: { ...menuPortalA11y },
  tags: ["ai-generated"],
  beforeEach: routeFileChat,
  play: async ({ canvasElement }) => {
    await openProjectSubmenu(canvasElement, "Change project");

    const request = await pickProject("Work");
    await expect(request.clone().json()).resolves.toEqual({
      projectId: null,
    });
  },
};

/**
 * "New project" hands off to the caller's single shared create-project dialog —
 * the row owns no dialog of its own. Selecting it asks the caller, one tick
 * later so the request doesn't race the menu's own close, and files the chat
 * into whatever project that dialog creates.
 *
 * @summary the New project item asks the caller to open its dialog
 */
export const ProjectMenuNewProject: Story = {
  args: { onNewProject: fn(), projects },
  parameters: { ...menuPortalA11y },
  tags: ["ai-generated"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /more/i }));
    await userEvent.hover(
      await screen.findByRole("menuitem", { name: "Add to project" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "New project" }),
    );

    await waitFor(() => expect(args.onNewProject).toHaveBeenCalledTimes(1));
  },
};

/**
 * Without a caller handler the item is disabled rather than a dead click: the
 * row never owns the create-project dialog itself.
 *
 * @summary the New project item disabled when the caller owns no dialog
 */
export const ProjectMenuNewProjectDisabled: Story = {
  args: { projects },
  parameters: { ...menuPortalA11y },
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /more/i }));
    await userEvent.hover(
      await screen.findByRole("menuitem", { name: "Add to project" }),
    );

    await expect(
      await screen.findByRole("menuitem", { name: "New project" }),
    ).toHaveAttribute("aria-disabled", "true");
  },
};

/**
 * "New chat here" copies this chat's location, so it needs the checkout list
 * that maps its root back onto a repository, an executor, and a checkout. While
 * that read is pending the row is a disabled placeholder, not a link that would
 * pre-fill a worktree of no known checkout.
 *
 * @summary New chat here stays disabled while the checkout list loads
 */
export const NewChatHerePending: Story = {
  args: { chat: { ...baseChat, projectId: "p1", workspaceRoot: BOUND_ROOT } },
  parameters: { ...menuPortalA11y },
  tags: ["ai-generated"],
  beforeEach: () =>
    routeCheckouts(() => new Promise<Response>(() => undefined)),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /more/i }));

    await expect(
      await screen.findByRole("menuitem", { name: "New chat here" }),
    ).toHaveAttribute("aria-disabled", "true");
  },
};

/**
 * With the checkout list loaded, "New chat here" is the deep link that copies
 * the source chat's project, repository, executor, and source checkout, and
 * asks for a worktree of it.
 *
 * @summary New chat here links to the bound root once the list loads
 */
export const NewChatHereLoaded: Story = {
  args: { chat: { ...baseChat, projectId: "p1", workspaceRoot: BOUND_ROOT } },
  parameters: { ...menuPortalA11y },
  tags: ["ai-generated"],
  beforeEach: () =>
    routeCheckouts(() => Promise.resolve(jsonResponse(boundCheckouts))),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /more/i }));

    await waitFor(async () => {
      await expect(
        screen.getByRole("menuitem", { name: "New chat here" }),
      ).toHaveAttribute(
        "href",
        "/chat/new?project=p1&repository=repo-1&executor=exec-1&checkout=co-1&worktree=1",
      );
    });
    await expect(
      screen.getByRole("menuitem", { name: "New chat here" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  },
};
