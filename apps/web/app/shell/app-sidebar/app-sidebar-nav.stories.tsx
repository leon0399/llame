import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { expect, within } from "storybook/test";

import { AppSidebarNav } from "./app-sidebar-nav";

const meta = {
  component: AppSidebarNav,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    nextjs: { appDirectory: true, navigation: { pathname: "/" } },
  },
  decorators: [
    (Story) => (
      <SidebarProvider className="min-h-0 w-fit">
        <div className="w-[16rem]">
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
} satisfies Meta<typeof AppSidebarNav>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The primary rail's main nav (admin-area-org-tree task 2.3): live links
 * (Chats, Projects) carry no chip, every not-yet-built placeholder renders
 * disabled with a visible "soon" chip (llame's unimplemented-UI convention:
 * disabled, never hidden), and Administration is absent here — it is its own
 * bottom-pinned group per AppShell.dc.html.
 *
 * @summary main nav with soon-chip placeholders and no admin item
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    for (const label of [
      "Dashboard",
      "Gallery",
      "Calendar",
      "Email",
      "Brain",
    ]) {
      const button = canvas.getByText(label).closest("button");
      await expect(button).toHaveAttribute("aria-disabled", "true");
      await expect(button?.textContent).toContain("soon");
    }

    for (const label of ["Chats", "Projects"]) {
      const el = canvas.getByText(label).closest("a, button");
      await expect(el?.textContent).not.toContain("soon");
    }

    await expect(canvas.queryByText("Administration")).not.toBeInTheDocument();
  },
};
