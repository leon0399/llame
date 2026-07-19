import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { TextShimmer } from "./text-shimmer.js";

// TextShimmer has no upstream shadcn docs example — it is our own component
// (a motion/react-driven shimmer sweep), so every story here carries the
// "ai-generated" provenance tag.
const meta = {
  component: TextShimmer,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs", "ai-generated"],
} satisfies Meta<typeof TextShimmer>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use the default block-level shimmer for an in-progress state, such as a
 * "Thinking…" placeholder while a chat response streams in. `duration` and
 * `spread` are live controls — try widening `spread` for a broader
 * highlight band, or shortening `duration` for a faster sweep.
 *
 * @summary for the default in-progress/loading indicator
 */
export const Basic: Story = {
  args: {
    children: "Thinking…",
    duration: 2,
    spread: 2,
  },
};

/**
 * Set `as="span"` to render inline within a sentence instead of the default
 * block-level `<p>` — e.g. a shimmering status word beside a spinner.
 *
 * @summary for rendering inline within surrounding text via as="span"
 */
export const AsInlineElement: Story = {
  render: (args) => (
    <p className="text-sm">
      Status: <TextShimmer {...args} as="span" />
    </p>
  ),
  args: {
    children: "generating",
  },
};
