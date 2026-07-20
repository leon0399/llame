import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";
import { SidebarMenu, SidebarProvider } from "@workspace/ui/components/sidebar";
import { expect, screen, userEvent, within } from "storybook/test";

import type { ProjectResponse } from "@/lib/services/project/types";
import { ProjectItem } from "./index";

const baseProject: ProjectResponse = {
  id: "p1",
  ownerUserId: "u1",
  name: "Acme relaunch",
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T10:00:00.000Z",
  archivedAt: null,
};

// Opening the row menu portals it and toggles aria-hidden on background
// siblings — the documented Radix false positive. Disable only that rule.
const menuPortalA11y = {
  a11y: {
    config: { rules: [{ id: "aria-hidden-focus", enabled: false }] },
  },
};

const meta = {
  component: ProjectItem,
  tags: ["autodocs"],
  args: { project: baseProject, isActive: false, isPinned: false },
  decorators: [
    (Story) => (
      // Width-only frame matching the projects secondary menu's harness. The
      // row stays transparent and shows only its own hover/active states;
      // min-h-0 w-fit stops SidebarProvider's min-h-svh/w-full from inflating
      // the canvas.
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
} satisfies Meta<typeof ProjectItem>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The default project row: folder icon + name, with the pin + kebab controls
 * revealed on hover.
 *
 * @summary the default project row
 */
export const Basic: Story = { tags: ["ai-generated"] };

/**
 * The row for the project currently open — highlighted, kebab always visible.
 *
 * @summary the selected/open project row
 */
export const Active: Story = {
  args: { isActive: true },
  tags: ["ai-generated"],
};

/**
 * A pinned project: the pin control stays visible even without hover.
 *
 * @summary a pinned project row
 */
export const Pinned: Story = {
  args: { isPinned: true },
  tags: ["ai-generated"],
};

/**
 * An archived project (surfaces in the Pinned section, which includes archived
 * pins): the "Archived" pill sits beside a de-emphasized name and dimmed icon.
 *
 * @summary an archived project row with the Archived pill + de-emphasis
 */
export const Archived: Story = {
  args: { project: { ...baseProject, archivedAt: "2026-07-19T09:00:00.000Z" } },
  // #232 — the Archived pill is muted-foreground on the secondary surface.
  parameters: { ...contrastKnownIssue232 },
  tags: ["ai-generated"],
};

/**
 * The "…" row menu opened — the lean project menu: pin, rename, and the
 * archive/delete lifecycle.
 *
 * @summary the project row menu open
 */
export const RowMenu: Story = {
  parameters: { ...menuPortalA11y },
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /more/i }));
    const menu = await screen.findByRole("menu");
    await expect(
      within(menu).getByRole("menuitem", { name: "Rename" }),
    ).toBeInTheDocument();
    await expect(
      within(menu).getByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
  },
};
