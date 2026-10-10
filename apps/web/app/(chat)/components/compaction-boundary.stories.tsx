import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import type { Compaction } from "@/lib/services/chat/history";
import { CompactionBoundary } from "./compaction-boundary";

const NO_STATS: Compaction["stats"] = {
  beforeTokens: null,
  afterTokens: null,
  modelId: null,
};

const FULL_STATS: Compaction["stats"] = {
  beforeTokens: 71_400,
  afterTokens: 12_800,
  modelId: "system:openai:gpt-4o",
};

const COMPACTION: Compaction = {
  absorbedThroughSeq: 18,
  absorbedMessageCount: 18,
  summary: "The user asked about X and Y.",
  createdAt: "2026-07-06T00:00:00.000Z",
  stats: NO_STATS,
};

const MODELS = [
  {
    id: "system:openai:gpt-4o",
    source: "system" as const,
    name: "GPT-4o",
    contextWindowTokens: 128_000,
    input: ["text" as const],
  },
];

const meta = {
  component: CompactionBoundary,
  tags: ["autodocs"],
  args: { compaction: COMPACTION },
  decorators: [
    (Story) => (
      <div className="w-144 max-w-full">
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
  args: {
    compaction: { ...COMPACTION, summary: "Compacted: discussed the roadmap." },
  },
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
 * The fully-informed state: the checkpoint row supplies the API-computed
 * absorbed-message count while its persisted usage supplies token savings and
 * model metadata in the chip and the before→after + model line inside the
 * card.
 */
export const WithStats: Story = {
  tags: ["ai-generated"],
  args: {
    compaction: {
      ...COMPACTION,
      summary: "Compacted: discussed the roadmap.",
      stats: FULL_STATS,
    },
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
 * Degraded-stats fallback: a checkpoint may carry only the API-computed
 * message count (no token usage) — the chip shows the count alone.
 */
export const CountOnlyStats: Story = {
  tags: ["ai-generated"],
  args: { compaction: { ...COMPACTION, summary: "Compacted." } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("18 messages")).toBeVisible();
  },
};

/**
 * The no-token-stats fallback: with no token usage to derive from, the
 * expanded card shows a relative timestamp while the chip keeps the count.
 *
 * @summary relative-time card fallback without token stats
 */
export const TimestampFallback: Story = {
  tags: ["ai-generated"],
  args: {
    compaction: {
      ...COMPACTION,
      summary: "Compacted.",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("18 messages")).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: /context compacted/i }),
    );
    await expect(canvas.getByText(/2 hours ago/i)).toBeVisible();
  },
};
