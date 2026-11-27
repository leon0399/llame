import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";

import type { ChatJobResponse } from "@/lib/api/generated/models";

import { JobsSectionView } from "./jobs-section";

const secondsAgo = (seconds: number) =>
  new Date(Date.now() - seconds * 1000).toISOString();

const job = (
  overrides: Partial<ChatJobResponse> &
    Pick<ChatJobResponse, "id" | "locator" | "state">,
): ChatJobResponse => ({
  chatId: "chat-1",
  intent: null,
  command: null,
  executor: "bash",
  stoppedBy: null,
  startedAt: secondsAgo(64),
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
    onFinishedOpenChange: () => {},
  },
} satisfies Meta<typeof JobsSectionView>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Stop all submits both live job ids without exposing Run controls. */
export const StopAllWithoutLiveRun: Story = {
  args: {
    jobs: [
      job({
        id: "job-1",
        locator: "job://bash-1",
        state: "running",
        intent: "Watching the web dev server",
      }),
      job({ id: "job-2", locator: "job://bash-2", state: "running" }),
    ],
    onStop: fn(),
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Stop all/ }));
    await expect(args.onStop).toHaveBeenCalledWith(["job-1", "job-2"]);
    await expect(
      canvas.queryByRole("button", { name: /run|generation/i }),
    ).toBeNull();
  },
};

/**
 * A running job goes by the intent of the call that started it, and by its
 * locator when that call carried none. Its stop control carries that name.
 */
export const RunningJobsByIntent: Story = {
  args: {
    jobs: [
      job({
        id: "job-1",
        locator: "job://bash-1",
        state: "running",
        intent: "Running the API integration suite against a fresh database",
        startedAt: secondsAgo(187),
      }),
      job({
        id: "job-2",
        locator: "job://bash-2",
        state: "running",
        startedAt: secondsAgo(9),
      }),
    ],
    onStop: fn(),
  },
  play: async ({ args, canvas }) => {
    await expect(canvas.getByText("job://bash-2")).toBeVisible();
    await expect(canvas.queryByText("job://bash-1")).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Stop Running the API integration suite against a fresh database",
      }),
    );
    await expect(args.onStop).toHaveBeenCalledWith(["job-1"]);
  },
};

/** Settled jobs stay out of the section; one control opens their panel. */
export const FinishedJobsBehindTheirControl: Story = {
  args: {
    jobs: [
      job({
        id: "job-1",
        locator: "job://bash-1",
        state: "running",
        intent: "Building the web app",
      }),
      job({
        id: "job-2",
        locator: "job://bash-2",
        state: "succeeded",
        intent: "Checking lint errors",
        exitCode: 0,
      }),
      job({ id: "job-3", locator: "job://bash-3", state: "failed" }),
    ],
    onFinishedOpenChange: fn(),
  },
  play: async ({ args, canvas }) => {
    await expect(canvas.getByText("Building the web app")).toBeVisible();
    await expect(canvas.queryByText("Checking lint errors")).toBeNull();
    await expect(canvas.queryByText("job://bash-3")).toBeNull();

    const finished = canvas.getByRole("button", { name: /Finished/ });

    await expect(finished).toHaveTextContent("2");
    await userEvent.click(finished);
    await expect(args.onFinishedOpenChange).toHaveBeenCalledWith(true);
  },
};

/** With nothing running, the section says so above the Finished control. */
export const OnlyFinishedJobs: Story = {
  args: {
    jobs: [
      job({
        id: "job-1",
        locator: "job://bash-1",
        state: "cancelled",
        stoppedBy: "owner",
      }),
    ],
    finishedOpen: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Nothing running")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: /Finished/ }),
    ).toHaveAttribute("aria-expanded", "true");
  },
};

/** A requested stop shows on the row and disables its control. */
export const StopRequested: Story = {
  args: {
    jobs: [
      job({
        id: "job-1",
        locator: "job://bash-1",
        state: "running",
        intent: "Watching the web dev server",
        stopRequestedAt: secondsAgo(1),
        stopRequestedBy: "owner",
      }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Stopping")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Stop Watching the web dev server" }),
    ).toBeDisabled();
  },
};

export const NoJobs: Story = {};

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
