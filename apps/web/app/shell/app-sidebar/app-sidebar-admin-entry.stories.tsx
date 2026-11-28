import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { expect, within } from "storybook/test";

import { MobileViewport } from "@/lib/test-support/mobile-viewport";

import { AppSidebarAdminEntry } from "./app-sidebar-admin-entry";

const meta = {
  component: AppSidebarAdminEntry,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    nextjs: { appDirectory: true, navigation: { pathname: "/" } },
  },
  decorators: [
    (Story, context) => (
      <MobileViewport active={context.parameters.mobileViewport === true}>
        <SidebarProvider className="min-h-0 w-fit">
          <div className="w-64">
            <Story />
          </div>
        </SidebarProvider>
      </MobileViewport>
    ),
  ],
} satisfies Meta<typeof AppSidebarAdminEntry>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The Administration entry as its own bottom-pinned group (admin-area-org-tree
 * task 2.2, per AppShell.dc.html): on desktop it is a live link into the admin
 * area, not a main-nav item and not a user-menu entry.
 *
 * @summary live desktop link into the admin area
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link", {
      name: /Administration/i,
    });

    await expect(link).toHaveAttribute("href", "/admin/organizations");
  },
};

/**
 * Route-awareness: anywhere under /admin the entry marks itself active, so
 * the rail shows where the user is even from nested admin pages.
 *
 * @summary active state on any /admin route
 */
export const ActiveOnAdminRoute: Story = {
  tags: ["ai-generated"],
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/admin/organizations" },
    },
  },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link", {
      name: /Administration/i,
    });

    // asChild renders the Link straight through Slot — data-active lands on
    // the <a> itself, there is no separate wrapping <button>.
    await expect(link).toHaveAttribute("data-active");
  },
};

/**
 * Mobile: the /admin area is desktop-only, so the entry keeps its row but
 * swaps the link for the shared disabled-not-hidden affordance instead of
 * offering a dead end (AppShell.dc.html).
 *
 * @summary disabled, non-navigable Administration entry on a phone
 */
export const Mobile: Story = {
  tags: ["ai-generated"],
  parameters: { mobileViewport: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Nothing to follow: `/admin` is unreachable from a phone.
    await expect(
      canvas.queryByRole("link", { name: /Administration/i }),
    ).toBeNull();

    // The row stays visible and reads as disabled rather than disappearing.
    const entry = canvas.getByRole("button", { name: /Administration/i });
    await expect(entry).toHaveAttribute("aria-disabled", "true");

    // Disabled ⇒ out of the tab order, like a natively disabled control.
    await expect(entry).toHaveAttribute("tabindex", "-1");
  },
};
