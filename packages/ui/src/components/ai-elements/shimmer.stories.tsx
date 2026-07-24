import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Shimmer } from "./shimmer.js";

// Shimmer is a vendored Vercel AI Elements component
// (https://elements.ai-sdk.dev/components/shimmer), not a shadcn primitive,
// so it has no shadcn docs to transcribe. It does have its own AI Elements
// docs examples though (source: vercel/ai-elements
// packages/examples/src/shimmer-duration.tsx and shimmer-elements.tsx) —
// DifferentDurations and CustomElements below transcribe those verbatim
// (only the import path is adapted, from `@repo/elements/shimmer` to
// `./shimmer.js`) and carry the "ai-elements-example" provenance tag
// alongside "ai-generated". Basic is our own minimal demo — it does not
// mirror either docs example, so it carries only "ai-generated".
const meta = {
  component: Shimmer,
  parameters: {
    layout: "centered",
  },
  // Default `children` so the render-only showcase stories (which supply their
  // own <Shimmer>s) still satisfy Shimmer's required `children` prop.
  args: {
    children: "Thinking…",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Shimmer>;

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
  tags: ["ai-generated"],
  args: {
    children: "Thinking…",
    duration: 2,
    spread: 2,
  },
};

/**
 * Use a shorter `duration` for a snappier sweep on quick operations, or a
 * longer one so a slow background task doesn't feel frantic.
 *
 * Verbatim from [AI Elements Shimmer › Different Durations](https://elements.ai-sdk.dev/components/shimmer#different-durations).
 *
 * @summary reference of the duration prop across a range of speeds
 */
export const DifferentDurations: Story = {
  tags: ["ai-elements-example", "ai-generated"],
  render: () => (
    <div className="flex flex-col gap-6 p-8">
      <div className="text-center">
        <p className="mb-3 text-muted-foreground text-sm">Fast (1 second)</p>
        <Shimmer duration={1}>Loading quickly...</Shimmer>
      </div>

      <div className="text-center">
        <p className="mb-3 text-muted-foreground text-sm">
          Default (2 seconds)
        </p>
        <Shimmer duration={2}>Loading at normal speed...</Shimmer>
      </div>

      <div className="text-center">
        <p className="mb-3 text-muted-foreground text-sm">Slow (4 seconds)</p>
        <Shimmer duration={4}>Loading slowly...</Shimmer>
      </div>

      <div className="text-center">
        <p className="mb-3 text-muted-foreground text-sm">
          Very Slow (6 seconds)
        </p>
        <Shimmer duration={6}>Loading very slowly...</Shimmer>
      </div>
    </div>
  ),
};

/**
 * Set `as` to render the shimmer as a paragraph, heading, inline span, or
 * div — the sweep and gradient styling stay identical across elements.
 *
 * Verbatim from [AI Elements Shimmer › Custom Elements](https://elements.ai-sdk.dev/components/shimmer#custom-elements).
 *
 * @summary reference of the as prop across paragraph, heading, span, and div
 */
export const CustomElements: Story = {
  tags: ["ai-elements-example", "ai-generated"],
  render: () => (
    <div className="flex flex-col gap-6 p-8">
      <div className="text-center">
        <p className="mb-3 text-muted-foreground text-sm">
          As paragraph (default)
        </p>
        <Shimmer as="p">This is rendered as a paragraph</Shimmer>
      </div>

      <div className="text-center">
        <p className="mb-3 text-muted-foreground text-sm">As heading</p>
        <Shimmer as="h2" className="font-bold text-2xl">
          Large Heading with Shimmer
        </Shimmer>
      </div>

      <div className="text-center">
        <p className="mb-3 text-muted-foreground text-sm">As span (inline)</p>
        <div>
          Processing your request{" "}
          <Shimmer as="span" className="inline">
            with AI magic
          </Shimmer>
          ...
        </div>
      </div>

      <div className="text-center">
        <p className="mb-3 text-muted-foreground text-sm">
          As div with custom styling
        </p>
        <Shimmer as="div" className="font-semibold text-lg">
          Custom styled shimmer text
        </Shimmer>
      </div>
    </div>
  ),
};
