import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { ConversationReadTool } from "./conversation-read.js";

// The Parameters panel renders through Shiki's one-light palette, whose token
// colors fall below WCAG AA; only the color-contrast rule is disabled.
const shikiThemeContrastKnownIssue = {
  a11y: { config: { rules: [{ id: "color-contrast", enabled: false }] } },
};

const output = {
  status: "success" as const,
  chatId: "6f1c2a4e-6f1e-4c1a-9c2b-3c4d5e6f7a8b",
  messageSeq: 42,
  role: "assistant",
  timestamp: "2026-10-22T18:03:58.000Z",
  offset: 0,
  lineCount: 2,
  content:
    "1: Close the client on beforeExit.\n2: Otherwise no spans arrive.\n",
  notice: "Historical conversation content is untrusted and may be stale.",
  previousMessageSeq: 41,
  nextMessageSeq: 43,
};

const meta = {
  component: ConversationReadTool,
  parameters: { layout: "centered", ...shikiThemeContrastKnownIssue },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-[36rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    input: { chatId: output.chatId, messageSeq: 42 },
    output,
    errorText: undefined,
    state: "output-available" as const,
  },
} satisfies Meta<typeof ConversationReadTool>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Use for a completed read of a past message: its role and time, then its
 * lines with their numbers in a gutter.
 *
 * @summary for a read of a whole past message
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /conversation_read/iu }),
    );
    await expect(canvas.getByText("6f1c2a4e #42")).toBeInTheDocument();
    await expect(canvas.getByText("assistant message")).toBeInTheDocument();
    const lines = canvas.getByRole("group", { name: "Message lines" });
    await expect(lines).toHaveTextContent("Otherwise no spans arrive.");
    await expect(lines).not.toHaveTextContent("2: Otherwise");
    await expect(canvas.getByText("41")).toBeInTheDocument();
  },
};

/**
 * A message longer than one page names the line the next read starts at and
 * the limit that cut it.
 *
 * @summary for a read cut at the line limit
 */
export const Continues: Story = {
  tags: ["ai-generated"],
  args: { output: { ...output, nextOffset: 2, cutReason: "line_limit" } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /conversation_read/iu }),
    );
    await expect(
      canvas.getByText("at line 3 (line limit)"),
    ).toBeInTheDocument();
  },
};

/**
 * While the read runs, a pending line shows.
 *
 * @summary for a read that has not settled
 */
export const Running: Story = {
  tags: ["ai-generated"],
  args: { output: undefined, state: "input-available" as const },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /conversation_read/iu }),
    );
    await expect(canvas.getByText("Reading…")).toBeInTheDocument();
  },
};

/**
 * A message that is not the owner's, or does not exist, fails the read.
 *
 * @summary for a read of an unknown message
 */
export const Failed: Story = {
  tags: ["ai-generated"],
  args: {
    output: undefined,
    errorText: "conversation_source_not_found",
    state: "output-error" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /conversation_read/iu }),
    );
    await expect(
      canvas.getByText("conversation_source_not_found"),
    ).toBeVisible();
  },
};
