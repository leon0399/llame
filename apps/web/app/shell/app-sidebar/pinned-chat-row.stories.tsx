import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
} from "@workspace/ui/components/sidebar";
import { expect, screen, userEvent, within } from "storybook/test";

import type { PinnedItem } from "@/lib/services/pins/types";
import { PinnedChatRow } from "./app-sidebar-pinned";

type PinnedChat = Extract<PinnedItem, { itemType: "chat" }>;

const chatPin: PinnedChat = {
  itemType: "chat",
  itemId: "c1",
  pinnedAt: "2026-07-20T10:00:00.000Z",
  item: { id: "c1", title: "Trip to Lisbon", archivedAt: null },
};

// The open rail menu portals and toggles aria-hidden on background siblings —
// the documented Radix false positive. Disable only that rule.
const menuPortalA11y = {
  a11y: {
    config: { rules: [{ id: "aria-hidden-focus", enabled: false }] },
  },
};

const meta = {
  component: PinnedChatRow,
  tags: ["autodocs"],
  args: { pin: chatPin },
  decorators: [
    (Story) => (
      // Width-only frame: the row stays transparent and shows only its own
      // hover/active states (it inherits whatever rail surface it sits on in the
      // app — no imposed background box here). min-h-0 w-fit stops
      // SidebarProvider's min-h-svh/w-full from inflating the canvas.
      <SidebarProvider className="min-h-0 w-fit">
        <div className="w-64 p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <Story />
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarProvider>
    ),
  ],
  parameters: { layout: "centered" },
} satisfies Meta<typeof PinnedChatRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A pinned chat in the rail: icon + title, single line (the rail's lean pin
 * card carries no excerpt), with a hover kebab.
 *
 * @summary the default pinned-chat rail row
 */
export const Basic: Story = { tags: ["ai-generated"] };

/**
 * The pinned chat whose route is open — highlighted, kebab always visible.
 *
 * @summary the active pinned-chat rail row
 */
export const Active: Story = {
  parameters: { nextjs: { navigation: { pathname: "/chat/c1" } } },
  tags: ["ai-generated"],
};

/**
 * An archived pinned chat: the "Archived" pill sits beside a de-emphasized
 * title and dimmed icon.
 *
 * @summary an archived pinned-chat rail row
 */
export const Archived: Story = {
  args: {
    pin: {
      ...chatPin,
      item: { ...chatPin.item, archivedAt: "2026-07-19T09:00:00.000Z" },
    },
  },
  // #232 — the Archived pill is muted-foreground on the secondary surface.
  parameters: { ...contrastKnownIssue232 },
  tags: ["ai-generated"],
};

/**
 * The rail row's lean menu — a subset of the list row's (the rail holds only
 * the reference card): unpin, rename, and the archive/delete lifecycle.
 *
 * @summary the pinned-chat rail row menu open
 */
export const RowMenu: Story = {
  parameters: { ...menuPortalA11y },
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /more/i }));
    const menu = await screen.findByRole("menu");
    await expect(
      within(menu).getByRole("menuitem", { name: "Unpin" }),
    ).toBeInTheDocument();
    await expect(
      within(menu).getByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
  },
};
