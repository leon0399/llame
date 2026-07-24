import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { Reasoning, ReasoningContent, ReasoningTrigger } from "./reasoning.js";

const REASONING_TEXT =
  "The user is asking for the capital of France. This is a straightforward factual question, so I can answer directly without using any tools.";

// `Reasoning`'s props extend `ComponentProps<typeof Collapsible>`, whose
// props reference Radix's non-exported `CollapsibleProps` — an inferred
// `satisfies Meta<typeof Reasoning>` object type can't be named once
// exported, so annotate explicitly instead (tsgo TS2883).
const meta: Meta<typeof Reasoning> = {
  component: Reasoning,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  render: (args) => (
    <Reasoning {...args}>
      <ReasoningTrigger />
      <ReasoningContent>{REASONING_TEXT}</ReasoningContent>
    </Reasoning>
  ),
};

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * While a model is still emitting reasoning tokens, the panel stays open and
 * the trigger shows the animated "Thinking…" label instead of an elapsed
 * duration, so the user can see reasoning arrive in real time. Transcribed
 * from the chat-integration example's reasoning block (`isStreaming` driven
 * by whether the last message part is still streaming reasoning).
 *
 * @summary for a reasoning panel that is actively streaming
 * @see https://elements.ai-sdk.dev/components/reasoning#usage-with-ai-sdk
 */
export const Streaming: Story = {
  tags: ["ai-elements-example", "ai-generated"],
  // Animated "Thinking…" shimmer — non-deterministic frames; skip visual
  // capture (interaction/a11y still run).
  parameters: { visualTests: { disable: true } },
  args: {
    className: "w-full",
    isStreaming: true,
  },
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("button", { name: /thinking/i });
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText(/capital of France/i)).toBeVisible();
  },
};

/**
 * Once reasoning has finished, the panel auto-collapses to a single-line
 * summary ("Thought for N seconds") so it doesn't compete with the model's
 * final answer — the user can still expand it to review the full trace.
 *
 * @summary for a finished reasoning panel the user can expand
 */
export const Collapsed: Story = {
  tags: ["ai-generated"],
  args: {
    isStreaming: false,
    defaultOpen: false,
    duration: 4,
  },
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", {
      name: /thought for 4 seconds/i,
    });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(
      canvas.queryByText(/capital of France/i),
    ).not.toBeInTheDocument();

    await userEvent.click(trigger);

    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const content = await canvas.findByText(/capital of France/i);
    await expect(content).toBeVisible();
  },
};
