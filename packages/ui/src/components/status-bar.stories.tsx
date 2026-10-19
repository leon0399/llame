import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ServerIcon } from "lucide-react";
import { expect } from "storybook/test";

import {
  StatusBar,
  StatusBarFrame,
  StatusBarGroup,
  StatusBarItem,
} from "./status-bar.js";

const meta = {
  component: StatusBar,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof StatusBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A frame with content above a bar: plain items at the start, a linked item
 * at the end.
 *
 * @summary the bar under an app shell, with plain and linked items
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  render: (args) => (
    <StatusBarFrame className="h-64">
      <div className="flex-1 p-4 text-sm">Content</div>
      <StatusBar {...args}>
        <StatusBarGroup>
          <StatusBarItem>58% 5h · 41% wk</StatusBarItem>
        </StatusBarGroup>
        <StatusBarGroup>
          <StatusBarItem render={<a href="#machines" />}>
            <ServerIcon aria-hidden="true" />
            2/3 online
          </StatusBarItem>
        </StatusBarGroup>
      </StatusBar>
    </StatusBarFrame>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("contentinfo")).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: "2/3 online" }),
    ).toHaveAttribute("href", "#machines");
  },
};
