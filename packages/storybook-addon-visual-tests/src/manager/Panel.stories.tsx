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
    currentStoryTitle: "Button / Primary",
    onCommand,
    state: {
      runId: "run-1",
      running: false,
      results: [
        {
          runId: "run-1",
          storyId: "button--primary",
          title: "Button / Primary",
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
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    const runVisualTests = canvas.getByRole("button", {
      name: "Run visual tests",
    });
    await expect(runVisualTests.className).not.toBe("");
    await expect(runVisualTests.querySelector("svg")).not.toBeNull();
    await expect(
      canvas.queryByText("Button / Secondary"),
    ).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Diff" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      canvas.getByRole("button", { name: "Latest" }),
    ).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(runVisualTests);
    await expect(onCommand).toHaveBeenLastCalledWith({
      type: "run",
      scope: "current",
      storyId: "button--primary",
    });
  },
};

export const NoResult: Story = {
  tags: ["ai-generated"],
  args: {
    state: { running: false, results: [] },
  },
  play: async ({ canvas }) => {
    const runVisualTests = canvas.getAllByRole("button", {
      name: "Run visual tests",
    });
    await userEvent.click(runVisualTests.at(-1)!);
    await expect(onCommand).toHaveBeenLastCalledWith({
      type: "run",
      scope: "current",
      storyId: "button--primary",
    });
  },
};

export const CaptureError: Story = {
  tags: ["ai-generated"],
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

export const Running: Story = {
  tags: ["ai-generated"],
  args: {
    state: {
      runId: "run-active",
      running: true,
      results: [],
    },
  },
  play: async ({ canvas }) => {
    const stop = canvas.getByRole("button", { name: "Stop visual tests" });
    await expect(
      Number.parseFloat(getComputedStyle(stop).paddingLeft),
    ).toBeGreaterThan(0);
  },
};

/**
 * Use the passed state to confirm a capture that matched its committed
 * baseline: the summary keeps a rerun affordance (never a stop button) and
 * offers no Accept, since there is nothing to approve. A passing comparison
 * emits no diff, so the Diff tab stays disabled and review falls back to the
 * latest capture.
 *
 * @summary for a story whose capture matched its baseline
 */
export const Passed: Story = {
  tags: ["ai-generated"],
  args: {
    currentStoryId: "button--primary",
    state: {
      runId: "run-passed",
      running: false,
      results: [
        {
          runId: "run-passed",
          storyId: "button--primary",
          title: "Button / Primary",
          environmentKey: "chromium-1280x720@1x",
          status: "passed",
          artifacts: { baseline: "baseline", candidate: "candidate" },
        },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Passed")).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Stop visual tests" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Run visual tests" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Diff" })).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Latest" }),
    ).toHaveAttribute("aria-pressed", "true");
  },
};

/**
 * Use the metadata-only change state when a capture is pixel-identical to its
 * baseline but the recorded environment no longer matches. The reviewer still
 * gets the explanation and both images to approve from, but no Diff view —
 * zero changed pixels would only render an empty one.
 *
 * @summary for an environment mismatch with no changed pixels
 */
export const MetadataOnlyChange: Story = {
  tags: ["ai-generated"],
  args: {
    currentStoryId: "button--primary",
    state: {
      runId: "run-metadata",
      running: false,
      results: [
        {
          runId: "run-metadata",
          storyId: "button--primary",
          title: "Button / Primary",
          environmentKey: "chromium-1280x720@1x",
          status: "changed",
          message:
            "Baseline environment metadata is incompatible with the candidate",
          diffPixels: 0,
          candidateSha256: "a".repeat(64),
          artifacts: { baseline: "baseline", candidate: "candidate" },
        },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Changed")).toBeInTheDocument();
    await expect(
      canvas.getByText(/Baseline environment metadata is incompatible/),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Diff" })).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Latest" }),
    ).toHaveAttribute("aria-pressed", "true");
    // Zero changed pixels must not cost the reviewer their approval path.
    await expect(canvas.getByRole("button", { name: /Accept/ })).toBeEnabled();
  },
};

/**
 * Use the baseline-only state to review a story's committed baseline before it
 * has been run locally: the Baseline tab is the sole available image and the
 * status stays "Not run" until a capture happens.
 *
 * @summary for viewing a committed baseline with no local run yet
 */
export const BaselineOnly: Story = {
  tags: ["ai-generated"],
  args: {
    currentStoryId: "button--primary",
    baselineArtifactId: "baseline",
    state: { running: false, results: [] },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Not run")).toBeInTheDocument();
    const baselineTab = canvas.getByRole("button", { name: "Baseline" });
    await expect(baselineTab).toBeEnabled();
    await expect(baselineTab).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByRole("button", { name: "Latest" })).toBeDisabled();
  },
};

export const StaticUnavailable: Story = {
  tags: ["ai-generated"],
  args: { available: false },
};
