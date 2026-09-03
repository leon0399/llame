import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { MessageType, type ConversationNode } from "./conversation-tree-model";
import { ConversationItem } from "./conversation-tree-item";

const baseNode: ConversationNode = {
  id: "node-1",
  type: MessageType.USER,
  content: "Can you help me analyze this dataset?",
  branch: "main",
  parentIds: [],
  children: [],
  timestamp: "2026-08-30T12:00:00.000Z",
  position: 0,
};

const meta = {
  component: ConversationItem,
  tags: ["autodocs"],
  args: {
    node: baseNode,
    index: 0,
    isSelected: false,
    isVisible: true,
    onClick: fn(),
    onHover: fn(),
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof ConversationItem>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The default row: not selected, fully visible, not archived.
 *
 * @summary a plain conversation-tree row
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      canvas.getByRole("button", {
        name: "You: Can you help me analyze this dataset?",
      }),
    ).toBeInTheDocument();
  },
};

/**
 * The active node in the tree — the accent background and primary left
 * border that distinguish it from every other row.
 *
 * @summary the currently selected row
 */
export const Selected: Story = {
  tags: ["ai-generated"],
  args: { isSelected: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByRole("button");

    await expect(row.className).toContain("bg-sidebar-accent");
    await expect(row.className).toContain("border-primary");
  },
};

/**
 * A node outside the selected node's ancestor/descendant trace
 * (computeVisibleConversations) — dimmed rather than removed, so the tree's
 * shape stays legible while browsing one branch.
 *
 * @summary a row outside the current selection's visible trace
 */
export const Dimmed: Story = {
  tags: ["ai-generated"],
  args: { isVisible: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByRole("button");

    await expect(row.className).toContain("opacity-60");
  },
};

/**
 * An archived node — a distinct dimming from the visibility trace above,
 * and the two are additive (an archived node outside the trace gets both).
 *
 * @summary an archived row
 */
export const Archived: Story = {
  tags: ["ai-generated"],
  args: { node: { ...baseNode, archived: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByRole("button");

    await expect(row.className).toContain("opacity-70");
  },
};

/**
 * Content past the 40-char preview limit is cut with a trailing ellipsis,
 * both in the visible label and its accessible name.
 *
 * @summary a row with a truncated preview
 */
export const TruncatesLongContent: Story = {
  tags: ["ai-generated"],
  args: {
    node: {
      ...baseNode,
      content:
        "This message is deliberately long enough to exceed the forty character preview limit.",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      canvas.getByText("This message is deliberately long enough..."),
    ).toBeInTheDocument();
  },
};

/**
 * The row is a `role="button"` div, not a native button (it's a positioned
 * item in the graph/tree layout) — clicking and Enter/Space both must invoke
 * `onClick`, matching native button semantics.
 *
 * @summary clicking or pressing Enter/Space selects the row
 */
export const InvokesOnClickOnActivation: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByRole("button");

    await userEvent.click(row);
    await expect(args.onClick).toHaveBeenCalledTimes(1);

    row.focus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onClick).toHaveBeenCalledTimes(2);

    await userEvent.keyboard(" ");
    await expect(args.onClick).toHaveBeenCalledTimes(3);
  },
};

/**
 * Hovering reports this row's id so the branch graph can highlight the
 * matching SVG node; leaving clears it back to null.
 *
 * @summary hovering the row reports its id, and clears on leave
 */
export const TracksHover: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByRole("button");

    await userEvent.hover(row);
    await expect(args.onHover).toHaveBeenCalledWith("node-1");

    await userEvent.unhover(row);
    await expect(args.onHover).toHaveBeenCalledWith(null);
  },
};
