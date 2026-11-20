import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent } from "storybook/test";

import { ChainOfThought } from "./chain-of-thought.js";
import { Reasoning, ReasoningTrigger } from "./reasoning.js";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "./tool.js";

// ChainOfThought is this package's composition of the shadcn/ui Trace
// component, after the Chain of Thought pattern
// (https://ui.shadcn.com/docs/ai-elements/base/chain-of-thought). The stories
// are our own, so they carry only "ai-generated".
const meta = {
  component: ChainOfThought,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-[36rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChainOfThought>;

export default meta;

type Story = StoryObj<typeof meta>;

const steps = (
  <>
    <Reasoning defaultOpen={false}>
      <ReasoningTrigger />
    </Reasoning>
    <Tool>
      <ToolHeader
        type="tool-grep"
        state="output-available"
        summary="cacheKey apps/web"
      />
      <ToolContent>
        <ToolInput input={{ pattern: "cacheKey", path: "apps/web" }} />
        <ToolOutput output={{ matches: 2 }} errorText={undefined} />
      </ToolContent>
    </Tool>
    <Tool>
      <ToolHeader
        type="tool-read"
        state="output-available"
        summary="next.config.ts:1-40"
      />
      <ToolContent>
        <ToolInput input={{ path: "next.config.ts:1-40" }} />
      </ToolContent>
    </Tool>
    <Tool>
      <ToolHeader
        type="tool-bash"
        state="output-available"
        summary="pnpm build"
      />
      <ToolContent>
        <ToolInput input={{ command: "pnpm build" }} />
      </ToolContent>
    </Tool>
  </>
);

/**
 * Use a finished group for the work between two pieces of an answer: it takes
 * one line of the transcript, and expands into its steps on demand.
 *
 * @summary for steps the agent has finished
 */
export const Finished: Story = {
  tags: ["ai-generated"],
  args: { title: "Worked through 4 steps", running: false, children: steps },
  play: async ({ canvas }) => {
    const summary = canvas.getByRole("button", {
      name: "Worked through 4 steps",
    });

    await expect(canvas.getByText("pnpm build")).not.toBeVisible();
    await userEvent.click(summary);
    await expect(await canvas.findByText("pnpm build")).toBeVisible();
  },
};

/**
 * Use `running` while the reply is still producing steps: the group is open,
 * so the reader watches the work as it happens.
 *
 * @summary for steps still being produced
 */
export const Running: Story = {
  tags: ["ai-generated"],
  args: {
    title: "Working…",
    running: true,
    children: (
      <>
        <Tool>
          <ToolHeader
            type="tool-grep"
            state="output-available"
            summary="cacheKey apps/web"
          />
          <ToolContent>
            <ToolInput input={{ pattern: "cacheKey" }} />
          </ToolContent>
        </Tool>
        <Tool>
          <ToolHeader
            type="tool-bash"
            state="input-available"
            summary="pnpm build"
          />
          <ToolContent>
            <ToolInput input={{ command: "pnpm build" }} />
          </ToolContent>
        </Tool>
      </>
    ),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("pnpm build")).toBeVisible();
  },
};

/**
 * Set `failed` when a step failed, so the collapsed summary still says so.
 *
 * @summary for a finished group with a failed step
 */
export const WithFailedStep: Story = {
  tags: ["ai-generated"],
  args: {
    title: "Worked through 2 steps, 1 failed",
    running: false,
    failed: true,
    children: (
      <>
        <Tool>
          <ToolHeader
            type="tool-read"
            state="output-available"
            summary="package.json"
          />
          <ToolContent>
            <ToolInput input={{ path: "package.json" }} />
          </ToolContent>
        </Tool>
        <Tool defaultOpen>
          <ToolHeader
            type="tool-bash"
            state="output-error"
            summary="pnpm install --frozen-lockfile"
          />
          <ToolContent>
            <ToolOutput
              output={undefined}
              errorText="ERR_PNPM_OUTDATED_LOCKFILE"
              state="output-error"
            />
          </ToolContent>
        </Tool>
      </>
    ),
  },
  play: async ({ canvas }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Worked through 2 steps, 1 failed" }),
    );
    await expect(
      await canvas.findByText("ERR_PNPM_OUTDATED_LOCKFILE"),
    ).toBeVisible();
  },
};
