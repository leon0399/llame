import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";

import { PanelView } from "./PanelView.js";

const onCommand = fn();

const meta = {
  title: "Visual Tests/Panel",
  component: PanelView,
  args: {
    available: true,
    currentStoryId: "button--primary",
    onCommand,
    state: {
      runId: "run-1",
      running: false,
      results: [
        {
          runId: "run-1",
          storyId: "button--primary",
          title: "Button / Primary",
          importPath: "../../../packages/ui/src/button.stories.tsx",
          environmentKey: "chromium-1280x720@1x",
          status: "changed",
          candidateSha256: "a".repeat(64),
          artifacts: {
            baseline: "baseline",
            candidate: "candidate",
            diff: "diff",
          },
        },
        {
          runId: "run-1",
          storyId: "button--secondary",
          title: "Button / Secondary",
          importPath: "../../../packages/ui/src/button.stories.tsx",
          environmentKey: "chromium-1280x720@1x",
          status: "passed",
        },
      ],
    },
  },
  parameters: { visualTests: { disable: true } },
} satisfies Meta<typeof PanelView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReviewChanges: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Run all" }));
    await expect(onCommand).toHaveBeenCalledWith({ type: "run", scope: "all" });
  },
};

export const StaticUnavailable: Story = {
  args: { available: false },
};
