import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";

import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from "@workspace/ui/components/sidebar";

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
  parameters: { layout: "fullscreen" },
  // The section's rows are sidebar menu rows, as in the details sidebar.
  decorators: [
    (Story) => (
      <SidebarProvider keyboardShortcut={null}>
        <Sidebar collapsible="none">
          <SidebarContent>
            <Story />
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    ),
  ],
} satisfies Meta<typeof JobsSectionView>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use when two or more jobs run: Stop all submits every live job id and exposes no Run control.
 *
 * @summary Stop all stops every live job
 */
export const StopAllWithoutLiveRun: Story = {
  tags: ["ai-generated"],
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
 * The default Jobs section: a running job goes by the intent of its call, and by its locator when the call carried none. Its stop control carries that name.
 *
 * @summary running jobs named by intent
 */
export const Basic: Story = {
  tags: ["ai-generated"],
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

/**
 * Settled jobs stay out of the section; one Finished row with their count opens their panel.
 *
 * @summary settled jobs behind the Finished row
 */
export const FinishedJobsBehindTheirControl: Story = {
  tags: ["ai-generated"],
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

/**
 * With nothing running, a muted row says so above the Finished row.
 *
 * @summary nothing running, finished jobs present
 */
export const OnlyFinishedJobs: Story = {
  tags: ["ai-generated"],
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

/**
 * A requested stop shows on the row and disables its control until the job settles.
 *
 * @summary a stop request in progress
 */
export const StopRequested: Story = {
  tags: ["ai-generated"],
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

/**
 * A Chat that has not started a job yet.
 *
 * @summary no jobs yet
 */
export const NoJobs: Story = { tags: ["ai-generated"] };

/**
 * While the job list loads.
 *
 * @summary job list loading
 */
export const Loading: Story = {
  tags: ["ai-generated"],
  args: { loading: true },
};

/**
 * When the job list cannot be read.
 *
 * @summary job list read failure
 */
export const ReadFailed: Story = {
  tags: ["ai-generated"],
  args: { error: "The request failed (503)." },
};

/**
 * When a stop request fails, the section names the failure above the jobs.
 *
 * @summary stop request failure
 */
export const StopFailed: Story = {
  tags: ["ai-generated"],
  args: {
    jobs: [job({ id: "job-1", locator: "job://bash-1", state: "running" })],
    stopError: "The request failed (409).",
  },
};
