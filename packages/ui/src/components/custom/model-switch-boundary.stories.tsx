import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, waitFor } from "storybook/test";

import { ModelSwitchBoundary } from "./model-switch-boundary.js";

const meta = {
  component: ModelSwitchBoundary,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: {
    fromModelId: "system:openai:gpt-5.4-mini",
    toModelId: "custom:anthropic:claude-sonnet",
    onInspectContext: fn(),
  },
} satisfies Meta<typeof ModelSwitchBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Use the collapsed boundary in routine chat history so a model change stays
 * visible without competing with the conversation.
 *
 * @summary for the normal compact transcript boundary
 */
export const Collapsed: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    // The accessible name carries both full ids, so a screen reader hears the
    // whole change even where the visible ids are truncated.
    const trigger = canvas.getByRole("button", {
      name: "Model changed from system:openai:gpt-5.4-mini to custom:anthropic:claude-sonnet",
    });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.getByText("system:openai:gpt-5.4-mini")).toBeVisible();
    await expect(
      canvas.getByText("custom:anthropic:claude-sonnet"),
    ).toBeVisible();
    await expect(canvas.queryByText(/effective system prompt/i)).toBeNull();
    await expect(
      canvas.queryByRole("button", { name: "View effective context" }),
    ).toBeNull();
  },
};

/**
 * Public model ids are opaque and may be long. This state verifies that both
 * ids remain readable without forcing horizontal transcript overflow.
 *
 * @summary for boundaries containing long public model ids
 */
export const LongModelIds: Story = {
  tags: ["ai-generated"],
  args: {
    fromModelId:
      "system:openai/model-with-a-deliberately-long-public-identifier-and-version",
    toModelId:
      "custom:anthropic/model-with-another-deliberately-long-public-identifier",
  },
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: /model changed from/i });
    const modelIds = Array.from(trigger.querySelectorAll("span.font-mono"));
    await expect(modelIds).toHaveLength(2);
    await expect(
      modelIds.every((modelId) => modelId.scrollWidth > modelId.clientWidth),
    ).toBe(true);

    await userEvent.hover(trigger);
    // Base UI's tooltip popup carries no `role="tooltip"`; find it by data-slot.
    const tooltip = await waitFor(() => {
      const content = document.querySelector<HTMLElement>(
        "[data-slot='tooltip-content']",
      );
      if (!content) throw new Error("Tooltip content not rendered");
      return content;
    });
    await expect(tooltip).toHaveTextContent(
      "system:openai/model-with-a-deliberately-long-public-identifier-and-version",
    );
    await expect(tooltip).toHaveTextContent(
      "custom:anthropic/model-with-another-deliberately-long-public-identifier",
    );
  },
};

/**
 * Keyboard users expand the boundary before choosing whether to inspect the
 * target run's effective context receipt.
 *
 * @summary for keyboard disclosure of model-switch details
 */
export const KeyboardDisclosure: Story = {
  tags: ["ai-generated"],
  play: async ({ args, canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: /model changed from/i });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText(/effective system prompt/i)).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "View effective context" }),
    );
    await expect(args.onInspectContext).toHaveBeenCalledTimes(1);
  },
};
