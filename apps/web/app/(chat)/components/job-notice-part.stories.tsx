import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import type { UIMessage } from "ai";

import { HostJobNotices } from "./job-notice-part";

const message: UIMessage = {
  id: "host-jobs",
  role: "assistant",
  metadata: { host: true },
  parts: [
    {
      type: "data-context",
      data: {
        v: 1,
        producer: "job",
        form: "notice",
        runId: "11111111-1111-4111-8111-111111111111",
        payload: {
          jobId: "22222222-2222-4222-8222-222222222222",
          locator: "job://bash-7",
          executor: "bash",
          state: "succeeded",
          elapsedMs: 1200,
          outputNames: ["stdout"],
        },
        text: "Private host output is not rendered",
      },
    },
    {
      type: "data-context",
      data: {
        v: 1,
        producer: "job",
        form: "notice",
        runId: "11111111-1111-4111-8111-111111111111",
        payload: {
          jobId: "33333333-3333-4333-8333-333333333333",
          locator: "job://bash-8",
          executor: "bash",
          state: "failed",
          elapsedMs: 2400,
          outputNames: [],
        },
      },
    },
  ],
};

const meta = {
  component: HostJobNotices,
  tags: ["autodocs"],
  args: { message },
  parameters: { layout: "padded" },
} satisfies Meta<typeof HostJobNotices>;

export default meta;

type Story = StoryObj<typeof meta>;

/** One muted notice per job named by a trusted host message. */
export const SettledJobs: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("job://bash-7 succeeded")).toBeVisible();
    await expect(canvas.getByText("job://bash-8 failed")).toBeVisible();
    await expect(canvas.queryByText(/Private host output/)).toBeNull();
  },
};

/** Signal termination carries a nullable exit code in the real settlement. */
export const SignalTerminated: Story = {
  args: {
    message: {
      ...message,
      parts: [
        {
          type: "data-context",
          data: {
            v: 1,
            producer: "job",
            form: "notice",
            runId: "11111111-1111-4111-8111-111111111111",
            payload: {
              jobId: "22222222-2222-4222-8222-222222222222",
              locator: "job://bash-7",
              executor: "bash",
              state: "failed",
              elapsedMs: 1200,
              outputNames: [],
              exitCode: null,
              signal: "SIGTERM",
            },
          },
        },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("job://bash-7 failed")).toBeVisible();
  },
};
