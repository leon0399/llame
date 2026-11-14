import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import type { ChatListItemResponse } from "@/lib/api/generated/models";
import type { PublicUserResponse } from "@/lib/services/auth/queries";
import type { PinnedItem } from "@/lib/services/pins/types";
import { jsonResponse } from "@/lib/test-support/fetch-responses";
import { AppSidebar, SidebarProvider } from "./index";

const ME: PublicUserResponse = {
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  emailVerified: null,
  image: null,
};

/** Enough pinned chats to run the rail's scrolling content past its height. */
const PINS: Array<PinnedItem> = Array.from({ length: 30 }, (_, index) => ({
  itemType: "chat",
  itemId: `c${index + 1}`,
  pinnedAt: "2026-01-01T00:00:00.000Z",
  item: {
    id: `c${index + 1}`,
    title: `Pinned chat ${index + 1}`,
    archivedAt: null,
  },
}));

const PINNED_CHATS: Array<ChatListItemResponse> = PINS.map((pin, index) => ({
  id: pin.itemId,
  ownerUserId: "user-1",
  title: `Pinned chat ${index + 1}`,
  visibility: "private",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  projectId: null,
  workspaceRoot: null,
  lastMessage: null,
  runningJobs: 0,
}));

// The real user, pin, and pinned-chat queries run against a stubbed fetch.
// An unrouted request fails the story.
const fetchMock = fn<typeof fetch>();

/** The rail once the signed-in user's footer and pins have loaded. */
async function loadedRail(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const user = await canvas.findByRole("button", { name: /Ada Lovelace/ });
  await canvas.findByRole("link", { name: "Pinned chat 30" });

  return { canvas, user };
}

/** The nearest region around `element` that scrolls its overflow. */
function scrollingAncestor(element: HTMLElement) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);

    if (overflowY === "auto" || overflowY === "scroll") return node;
  }

  throw new Error("expected a scrolling region around the element");
}

const meta = {
  component: AppSidebar,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/" } },
    // Every story shows the user footer, whose initials avatar draws muted
    // ink on a muted fill at 4.34:1 (#232).
    ...contrastKnownIssue232,
  },
  beforeEach: () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    fetchMock.mockClear();
    fetchMock.mockImplementation((input) => {
      const request = input instanceof Request ? input : new Request(input);
      const key = `${request.method} ${new URL(request.url).pathname}`;

      if (key === "GET /auth/v1/me") return Promise.resolve(jsonResponse(ME));

      if (key === "GET /api/v1/pins")
        return Promise.resolve(jsonResponse(PINS));

      if (key === "GET /api/v1/chats") {
        const url = new URL(request.url);

        if (
          url.searchParams.get("pinned") !== "only" ||
          url.searchParams.get("archived") !== "with"
        ) {
          throw new Error(`unexpected chat list filters: ${url.search}`);
        }

        return Promise.resolve(jsonResponse(PINNED_CHATS));
      }

      throw new Error(`unrouted fetch in story: ${key}`);
    });

    return () => {
      globalThis.fetch = originalFetch;
    };
  },
  render: (args) => (
    <SidebarProvider>
      <AppSidebar {...args} />
    </SidebarProvider>
  ),
} satisfies Meta<typeof AppSidebar>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Administration is its own group pinned to the bottom of the rail: below the
 * main nav and the pinned chats, directly above the signed-in user's footer,
 * and it stays in place while the nav and pins scroll beneath it. It is not
 * repeated among the main nav items.
 *
 * @summary Administration pinned above the user footer, outside the scroll
 */
export const AdministrationAboveTheUserFooter: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const { canvas, user } = await loadedRail(canvasElement);
    const lastNavItem = canvas.getByText("Brain");

    await expect(
      canvas.getAllByRole("link", { name: /Administration/ }),
    ).toHaveLength(1);
    const admin = canvas.getByRole("link", { name: "Administration" });
    await expect(admin.getBoundingClientRect().top).toBeGreaterThan(
      lastNavItem.getBoundingClientRect().bottom,
    );
    await expect(admin.getBoundingClientRect().bottom).toBeLessThan(
      user.getBoundingClientRect().top,
    );

    // Scroll the rail's content to its end: the pins slide under the
    // Administration entry, which stays where it was, still in view.
    const scrolling = scrollingAncestor(lastNavItem);
    const adminTop = admin.getBoundingClientRect().top;
    const navTop = lastNavItem.getBoundingClientRect().top;
    await expect(scrolling.scrollHeight).toBeGreaterThan(
      scrolling.clientHeight,
    );
    scrolling.scrollTop = scrolling.scrollHeight;

    await expect(lastNavItem.getBoundingClientRect().top).toBeLessThan(navTop);
    await expect(admin.getBoundingClientRect().top).toBe(adminTop);
    await expect(
      canvas
        .getByRole("link", { name: "Pinned chat 30" })
        .getBoundingClientRect().bottom,
    ).toBeLessThanOrEqual(adminTop);
  },
};

/**
 * The signed-in user's menu offers Settings but no Administration entry:
 * Administration lives in the rail only.
 *
 * @summary the user menu has no Administration entry
 */
export const UserMenuWithoutAdministration: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const { user } = await loadedRail(canvasElement);

    await userEvent.click(user);
    // The menu portals into document.body, outside the story canvas.
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(menu).toBeVisible());

    await expect(
      within(menu).getByRole("menuitem", { name: "Settings" }),
    ).toBeVisible();
    await expect(
      within(menu).queryByRole("menuitem", { name: /Administration/ }),
    ).toBeNull();
  },
};
