import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";
import { ThemeProvider, convert, themes } from "storybook/theming";

import { PanelView } from "./PanelView.js";

const onCommand = fn();

const meta = {
  title: "Visual Tests/Panel",
  component: PanelView,
  decorators: [
    (Story) => (
      <ThemeProvider theme={convert(themes.light)}>
        <Story />
      </ThemeProvider>
    ),
  ],
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
    const runVisualTests = canvas.getByRole("button", {
      name: "Run visual tests",
    });
    await expect(runVisualTests.className).not.toBe("");
    await expect(runVisualTests.querySelector("svg")).not.toBeNull();
    await expect(
      canvas.queryByText("Button / Secondary"),
    ).not.toBeInTheDocument();
    await userEvent.click(runVisualTests);
    await expect(onCommand).toHaveBeenCalledWith({ type: "run", scope: "all" });
  },
};

export const CaptureError: Story = {
  args: {
    currentStoryId: "button--primary",
    state: {
      runId: "run-error",
      running: false,
      results: [
        {
          runId: "run-error",
          storyId: "button--primary",
          title: "Button / Primary",
          importPath: "../../../packages/ui/src/button.stories.tsx",
          environmentKey: "chromium-1280x720@1x",
          status: "capture-error",
          message:
            "Visual capture failed: Story root does not exist: packages/ui/src",
        },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Story root does not exist",
    );
  },
};

export const StaticUnavailable: Story = {
  args: { available: false },
};
