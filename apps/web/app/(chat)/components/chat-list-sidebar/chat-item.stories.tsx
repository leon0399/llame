import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";
import { SidebarMenu, SidebarProvider } from "@workspace/ui/components/sidebar";
import { expect, fn, screen, userEvent, within } from "storybook/test";

// Import the mocked context via the REAL specifier (not the __mocks__ file
// directly): sb.mock (preview.tsx) redirects it to the mock, so overriding
// `useActiveRuns.mockReturnValue(...)` here affects the SAME instance the
// component reads (a direct __mocks__ import is a separate module instance, so
// the override would never reach the component and the status dot never shows).
import * as activeRunsContext from "@/contexts/active-runs-context";
import type * as activeRunsContextMock from "@/contexts/__mocks__/active-runs-context";
// Import the pins mutations via the REAL specifier: sb.mock (preview.tsx)
// redirects it to the __mocks__ module, so this is the SAME stable `pinMutate`
// spy the component's `usePinItem().mutate` returns (a direct __mocks__ import
// would be a separate module instance and never see the component's calls).
import * as pinsMutations from "@/lib/services/pins/mutations";
import type * as pinsMutationsMock from "@/lib/services/pins/__mocks__/mutations";
import type { ChatResponse } from "@/lib/services/chat/queries";
import type { ProjectResponse } from "@/lib/services/project/types";
import { ChatItem } from "./chat-item";

// Runtime values are the redirected mock modules; type them as the mocks so
// the spies carry their assertion/reset methods and the mock-only helper.
const { pinMutate } = pinsMutations as unknown as typeof pinsMutationsMock;
const { useActiveRuns, emptyActiveRuns } =
  activeRunsContext as unknown as typeof activeRunsContextMock;

const baseChat: ChatResponse = {
  id: "chat-1",
  title: "Acme relaunch plan",
  lastMessage: "The todos are on the project — want me to draft the IA next?",
  visibility: "private",
  projectId: null,
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T10:00:00.000Z",
  archivedAt: null,
};

const projects: ProjectResponse[] = [
  {
    id: "p1",
    ownerUserId: "u1",
    name: "Work",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
  },
  {
    id: "p2",
    ownerUserId: "u1",
    name: "Research",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
  },
];

const meta = {
  component: ChatItem,
  tags: ["autodocs"],
  args: {
    chat: baseChat,
    onSelect: fn(),
    isActive: false,
    isPinned: false,
    projects: [],
  },
  // The mocked activity is ID-KEYED, not per-story state: only "chat-processing"
  // and "chat-unread" carry a dot. This is stable across every story, so on the
  // autodocs page (where all stories co-render and share the one module-level
  // useActiveRuns spy) each row shows the status matching ITS OWN chat.id —
  // Basic ("chat-1") stays clean instead of inheriting a status story's state.
  beforeEach: () => {
    useActiveRuns.mockReturnValue({
      ...emptyActiveRuns(),
      activeChatIds: new Set(["chat-processing"]),
      completedChats: new Set(["chat-unread"]),
    });
    pinMutate.mockClear();
  },
  decorators: [
    (Story) => (
      // Width-only frame matching the chats secondary menu's harness
      // (SidebarProvider → SidebarMenu). The row stays transparent and shows
      // only its own hover/active states; min-h-0 w-fit stops SidebarProvider's
      // min-h-svh/w-full from inflating the canvas.
      <SidebarProvider className="min-h-0 w-fit">
        <div className="w-[17rem] p-2">
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
 * kebab controls revealed on hover.
 *
 * @summary the default two-line chat row
 */
export const Basic: Story = { tags: ["ai-generated"] };

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
 * A pinned chat: the pin control stays visible (filled) even without hover, so
 * the pinned state is legible at rest.
 *
 * @summary a pinned chat row
 */
export const Pinned: Story = {
  args: { isPinned: true },
  tags: ["ai-generated"],
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
 * Asserted via the row menu's Pin item (the quick-action mirrors it).
 *
 * @summary the Pin action fires the pin mutation with a synthesized card
 */
export const Pin: Story = {
  parameters: { ...menuPortalA11y },
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /more/i }));
    // Radix menus portal to the document body — query from screen, not canvas.
    await userEvent.click(await screen.findByRole("menuitem", { name: "Pin" }));
    await expect(pinMutate).toHaveBeenCalledWith({
      itemType: "chat",
      itemId: "chat-1",
      card: { id: "chat-1", title: "Acme relaunch plan", archivedAt: null },
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
 * The move-to-project submenu is a searchable radio list; typing narrows the
 * projects (client-side filter over the caller's project list).
 *
 * @summary filtering the move-to-project submenu
 */
export const ProjectMenuFilter: Story = {
  args: { projects },
  parameters: { ...menuPortalA11y },
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /more/i }));
    await userEvent.hover(
      await screen.findByRole("menuitem", { name: "Add to project" }),
    );
    const filter = await screen.findByPlaceholderText("Search projects…");
    await userEvent.type(filter, "res");
    await expect(
      await screen.findByRole("menuitemradio", { name: "Research" }),
    ).toBeInTheDocument();
    await expect(
      screen.queryByRole("menuitemradio", { name: "Work" }),
    ).toBeNull();
  },
};
