import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import type { CompactionStats } from "@/lib/services/chat/history";
import { CompactionBoundary } from "./compaction-boundary";

const NO_STATS: CompactionStats = {
  absorbedMessageCount: null,
  beforeTokens: null,
  afterTokens: null,
  modelId: null,
};

const FULL_STATS: CompactionStats = {
  absorbedMessageCount: 18,
  beforeTokens: 71_400,
  afterTokens: 12_800,
  modelId: "system:openai:gpt-4o",
};

const MODELS = [
  {
    id: "system:openai:gpt-4o",
    source: "system" as const,
    name: "GPT-4o",
    contextWindowTokens: 128_000,
  },
];

const meta = {
  component: CompactionBoundary,
  tags: ["autodocs"],
  args: {
    summary: "The user asked about X and Y.",
    createdAt: "2026-07-06T00:00:00.000Z",
    stats: NO_STATS,
  },
  decorators: [
    (Story) => (
      <div className="w-[36rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "centered" },
} satisfies Meta<typeof CompactionBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The resting state readers see in a transcript: a Checkpoint pill between two
 * rules, collapsed so the compacted summary never competes with live chat.
 *
 * @summary collapsed checkpoint chip in a transcript
 */
export const Collapsed: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: /context compacted/i });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    // The result card is not in the document until expanded.
    await expect(
      canvas.queryByText("The user asked about X and Y."),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByText("Compaction result"),
    ).not.toBeInTheDocument();
  },
};

/**
 * Use when the reader wants the compacted context itself: clicking the chip
 * discloses an INLINE result card with the plaintext summary — never a modal,
 * so the transcript's reading flow is preserved.
 *
 * @summary inline result card disclosure (no modal)
 */
export const Expanded: Story = {
  tags: ["ai-generated"],
  args: { summary: "Compacted: discussed the roadmap." },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /context compacted/i }),
    );
    await expect(canvas.getByText("Compaction result")).toBeVisible();
    await expect(
      canvas.getByText("Compacted: discussed the roadmap."),
    ).toBeVisible();
    await expect(
      canvas.getByText(/full transcript is preserved and still searchable/i),
    ).toBeVisible();
    // Design's inline disclosure, not a Dialog overlay.
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
  },
};

/**
 * The fully-informed state (#136 read-side merge): real compression stats in
 * the chip (message count + token savings) and the before→after + model line
 * inside the card.
 *
 * @summary chip savings and card breakdown with full stats
 */
export const WithStats: Story = {
  tags: ["ai-generated"],
  args: {
    summary: "Compacted: discussed the roadmap.",
    stats: FULL_STATS,
    models: MODELS,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 71400 - 12800 = 58600 -> "58.6k" (design's own fmtTokens formatting).
    await expect(
      canvas.getByText("18 messages · saved 58.6k tokens"),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: /context compacted/i }),
    );
    await expect(
      canvas.getByText("71.4k → 12.8k tokens · GPT-4o"),
    ).toBeVisible();
  },
};

/**
 * Degraded-stats fallback: an older or seeded compaction may carry only a
 * message count (no token usage) — the chip shows the count alone.
 *
 * @summary chip fallback when token stats are absent
 */
export const CountOnlyStats: Story = {
  tags: ["ai-generated"],
  args: {
    summary: "Compacted.",
    stats: {
      absorbedMessageCount: 18,
      beforeTokens: null,
      afterTokens: null,
      modelId: null,
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("18 messages")).toBeVisible();
  },
};

/**
 * The no-stats fallback: with nothing derivable, both the chip and the
 * expanded card fall back to the same relative timestamp.
 *
 * @summary relative-time fallback with no stats at all
 */
export const TimestampFallback: Story = {
  tags: ["ai-generated"],
  args: {
    summary: "Compacted.",
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/2 hours ago/i)).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: /context compacted/i }),
    );
    // Both slots show the same relative time — two separate elements.
    await expect(canvas.getAllByText(/2 hours ago/i)).toHaveLength(2);
  },
};
