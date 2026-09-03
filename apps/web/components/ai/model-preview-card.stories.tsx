import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import type { AvailableModel } from "@/lib/services/models/queries";
import { AvailableModelResponseSource } from "@/lib/api/generated/models";
import { ModelPreviewCard } from "./model-preview-card";

const fullModel: AvailableModel = {
  id: "anthropic/claude-opus-5",
  source: AvailableModelResponseSource.system,
  name: "Claude Opus 5",
  description: "Anthropic's most capable model, tuned for complex reasoning.",
  contextWindowTokens: 1_000_000,
  pricingUsdPer1M: { input: 15, cachedInput: 1.5, output: 75 },
  knowledgeCutoff: "2026-05-01",
  releasedAt: "2026-06-15",
  apiDocs: "https://docs.anthropic.com/en/api",
  modelPage: "https://www.anthropic.com/claude/opus",
};

const meta = {
  component: ModelPreviewCard,
  tags: ["autodocs"],
  args: { model: fullModel },
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-[24rem] border rounded-lg">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ModelPreviewCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Every optional field populated: description, all three per-million-token
 * prices, both dates, and both external links.
 *
 * @summary the fully populated model preview
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Claude Opus 5")).toBeInTheDocument();
    await expect(canvas.getByText("1,000,000 tokens")).toBeInTheDocument();
    await expect(canvas.getByText("$15.00 / 1M tokens")).toBeInTheDocument();
    await expect(canvas.getByText("$1.50 / 1M tokens")).toBeInTheDocument();
    await expect(canvas.getByText("$75.00 / 1M tokens")).toBeInTheDocument();
    await expect(canvas.getByText("May 1, 2026")).toBeInTheDocument();
    await expect(canvas.getByText("June 15, 2026")).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "API Docs" }),
    ).toHaveAttribute("target", "_blank");
    await expect(
      canvas.getByRole("link", { name: "Model Page" }),
    ).toBeInTheDocument();
  },
};

/**
 * The minimum viable model: only the required id and context window. Every
 * optional row (description, pricing, dates) and the whole footer disappear
 * rather than rendering as empty rows or dead links.
 *
 * @summary the minimal model, with every optional row absent
 */
export const MinimalModel: Story = {
  tags: ["ai-generated"],
  args: {
    model: {
      id: "local/tiny-model",
      source: AvailableModelResponseSource.system,
      contextWindowTokens: 8192,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Falls back to the raw id as the heading when `name` is absent.
    await expect(
      canvas.getByRole("heading", { name: "local/tiny-model" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("8,192 tokens")).toBeInTheDocument();
    await expect(canvas.queryByText("Input")).not.toBeInTheDocument();
    await expect(
      canvas.queryByText("Knowledge Cutoff"),
    ).not.toBeInTheDocument();
    await expect(
      canvasElement.querySelector('[data-slot="separator"]'),
    ).not.toBeInTheDocument();
  },
};

/**
 * A model priced without a cached-input tier — the middle pricing row is
 * omitted rather than showing a placeholder, while input/output stay.
 *
 * @summary pricing with no cached-input tier
 */
export const NoCachedInputPricing: Story = {
  tags: ["ai-generated"],
  args: {
    model: {
      ...fullModel,
      pricingUsdPer1M: { input: 3, output: 15 },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("$3.00 / 1M tokens")).toBeInTheDocument();
    await expect(canvas.getByText("$15.00 / 1M tokens")).toBeInTheDocument();
    await expect(canvas.queryByText("Cached input")).not.toBeInTheDocument();
  },
};
