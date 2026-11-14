import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";

import type { ChatJobResponse } from "@/lib/api/generated/models";

import { JobsSectionView } from "./jobs-section";

const job = (
  overrides: Partial<ChatJobResponse> &
    Pick<ChatJobResponse, "id" | "locator" | "state">,
): ChatJobResponse => ({
  chatId: "chat-1",
  executor: "bash",
  stoppedBy: null,
  startedAt: "2026-11-12T09:00:00.000Z",
  settledAt: null,
  stopRequestedAt: null,
  stopRequestedBy: null,
  outputs: [],
  truncated: [],
  exitCode: null,
  signal: null,
  outcomeUnknown: false,
  artifact: null,
  ...overrides,
});

const meta = {
  title: "Chat/Session details/Jobs section",
  component: JobsSectionView,
  args: {
    jobs: [],
    onStop: () => {},
  },
} satisfies Meta<typeof JobsSectionView>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Stop all submits both live job ids without exposing Run controls. */
export const StopAllWithoutLiveRun: Story = {
  args: {
    jobs: [
      job({ id: "job-1", locator: "job://bash-1", state: "running" }),
      job({ id: "job-2", locator: "job://bash-2", state: "running" }),
    ],
    onStop: fn(),
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Stop all" }));
    await expect(args.onStop).toHaveBeenCalledWith(["job-1", "job-2"]);
    await expect(
      canvas.queryByRole("button", { name: /run|generation/i }),
    ).toBeNull();
  },
};

/** Live jobs remain first, followed by settled outcomes in server order. */
export const LiveAndSettledJobs: Story = {
  args: {
    jobs: [
      job({ id: "job-1", locator: "job://bash-1", state: "running" }),
      job({
        id: "job-2",
        locator: "job://bash-2",
        state: "succeeded",
        exitCode: 0,
      }),
      job({
        id: "job-3",
        locator: "job://bash-3",
        state: "failed",
        exitCode: 1,
      }),
      job({ id: "job-4", locator: "job://bash-4", state: "cancelled" }),
      job({ id: "job-5", locator: "job://bash-5", state: "timed_out" }),
      job({
        id: "job-6",
        locator: "job://bash-6",
        state: "lost",
        outcomeUnknown: true,
      }),
    ],
  },
};

export const Loading: Story = { args: { loading: true } };

export const ReadFailed: Story = {
  args: { error: "The request failed (503)." },
};

export const StopFailed: Story = {
  args: {
    jobs: [job({ id: "job-1", locator: "job://bash-1", state: "running" })],
    stopError: "The request failed (409).",
  },
};
