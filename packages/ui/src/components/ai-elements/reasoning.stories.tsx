import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { ReasoningContent } from "./reasoning-content.js";
import { Reasoning, ReasoningTrigger } from "./reasoning.js";

const REASONING_TEXT =
  "The user is asking for the capital of France. This is a straightforward factual question, so I can answer directly without using any tools.";

const REASONING_MATH_TEXT =
  "Rest energy is $E = mc^2$, and the Pythagorean identity is \\(a^2 + b^2 = c^2\\). Summing the first n integers:\n\n" +
  String.raw`$$\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$$`;

// `Reasoning`'s props extend `ComponentProps<typeof Collapsible>`, whose
// props reference Radix's non-exported `CollapsibleProps` — an inferred
// `satisfies Meta<typeof Reasoning>` object type can't be named once
// exported, so annotate explicitly instead (tsgo TS2883).
const meta: Meta<typeof Reasoning> = {
  component: Reasoning,
  // Full-width: Reasoning is a `w-full` collapsible, so let it span the canvas
  // and align to the real edges. No narrowing decorator — a centered inner
  // column inside the full-width padded root floats in the visual capture.
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
 * Reasoning renders through the same Streamdown pipeline as a reply, so a
 * model that thinks in math shows rendered formulas rather than raw LaTeX —
 * including the escaped `\(…\)` delimiters several providers emit instead of
 * dollars.
 *
 * @summary for a reasoning panel whose trace contains LaTeX math
 */
export const MathDelimiters: Story = {
  tags: ["ai-generated"],
  args: {
    isStreaming: false,
    defaultOpen: true,
    duration: 2,
  },
  render: (args) => (
    <Reasoning {...args}>
      <ReasoningTrigger />
      <ReasoningContent>{REASONING_MATH_TEXT}</ReasoningContent>
    </Reasoning>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll(".katex")).toHaveLength(3);
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

/**
 * OpenAI/Anthropic reasoning summaries arrive as discrete headed blocks.
 * Providers that drop `summary_index` concatenate them into a `****` run
 * that markdown cannot parse as bold or as a heading — this story is that
 * glued wire shape after the display repair, so each title is its own
 * strong heading rather than one half-bold paragraph.
 *
 * @summary for a reasoning panel whose trace is discrete summary parts
 * @see https://github.com/vercel/ai/issues/6742
 */
export const SummaryParts: Story = {
  tags: ["ai-generated"],
  args: {
    isStreaming: false,
    defaultOpen: true,
    duration: 3,
  },
  render: (args) => (
    <Reasoning {...args}>
      <ReasoningTrigger />
      <ReasoningContent>
        {
          "**Investigating likely culprit PRs****Inspecting message schema**\n\nThe stored parts array is the source of truth."
        }
      </ReasoningContent>
    </Reasoning>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(
      canvas.getByText(/investigating likely culprit prs/i),
    ).toBeVisible();
    await expect(canvas.getByText(/inspecting message schema/i)).toBeVisible();
    await expect(canvasElement.textContent).not.toContain("****");
    await expect(
      canvasElement.querySelectorAll('[data-streamdown="strong"]'),
    ).toHaveLength(2);
  },
};
