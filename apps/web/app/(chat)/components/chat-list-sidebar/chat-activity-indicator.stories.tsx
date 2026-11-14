import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { ChatActivityIndicator } from "./chat-activity-indicator";

const meta = {
  component: ChatActivityIndicator,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof ChatActivityIndicator>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The unread badge on a chat row: a completed reply the user hasn't opened
 * yet.
 *
 * @summary unread-reply badge
 */
export const Unread: Story = {
  tags: ["ai-generated"],
  args: { status: "unread" },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByLabelText("Unread reply"),
    ).toBeVisible();
  },
};

/**
 * The failed badge: a run failed or expired while the user was elsewhere.
 *
 * @summary failed-run badge
 */
export const Failed: Story = {
  tags: ["ai-generated"],
  args: { status: "failed" },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByLabelText("Run failed"),
    ).toBeVisible();
  },
};

/**
 * The processing badge (spinner ring) while a run is generating — it takes
 * precedence over both background jobs and unseen outcomes.
 * @summary generating-response spinner badge
 */
export const Processing: Story = {
  tags: ["ai-generated"],
  args: { status: "processing" },
  play: async ({ canvasElement }) => {
    const badge = within(canvasElement).getByLabelText("Generating response");
    await expect(badge).toBeVisible();
    await expect(badge.className).toContain("animate-spin");
  },
};

/**
 * A live job without a generating Run keeps the chat visible as background
 * work.
 *
 * @summary background-job badge
 */
export const Background: Story = {
  tags: ["ai-generated"],
  args: { status: "background" },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByLabelText("Background work"),
    ).toBeVisible();
  },
};

/**
 * An idle chat renders no indicator at all — absence is the design, not a
 * hidden element.
 *
 * @summary nothing rendered for a null status
 */
export const Idle: Story = {
  tags: ["ai-generated"],
  args: { status: null },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("[aria-label]")).toBeNull();
  },
};
