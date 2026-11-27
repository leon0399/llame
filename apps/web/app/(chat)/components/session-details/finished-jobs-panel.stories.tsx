import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import type { ChatJobResponse } from "@/lib/api/generated/models";

import { FinishedJobsPanel } from "./finished-jobs-panel";

// SAFETY: `--finished-jobs-width` is a CSS custom property, a valid inline
// style key that CSSProperties does not model; the app's provider sets it too.
const PANEL_WIDTH = { "--finished-jobs-width": "20rem" } as CSSProperties;

const settled = (
  overrides: Partial<ChatJobResponse> &
    Pick<ChatJobResponse, "id" | "locator" | "state" | "settledAt">,
): ChatJobResponse => ({
  chatId: "chat-1",
  intent: null,
  command: null,
  executor: "bash",
  stoppedBy: null,
  startedAt: "2026-11-27T09:00:00.000Z",
  stopRequestedAt: null,
  stopRequestedBy: null,
  outputs: ["stdout", "stderr"],
  truncated: [],
  exitCode: null,
  signal: null,
  outcomeUnknown: false,
  artifact: null,
  ...overrides,
});

const JOBS = [
  settled({
    id: "job-1",
    locator: "job://bash-1",
    state: "succeeded",
    intent: "Updating main and gathering the product context",
    command:
      "git fetch -q origin && git log --oneline main..origin/main | head -20",
    exitCode: 0,
    settledAt: "2026-11-27T09:00:04.000Z",
    artifact: "artifact://bash-1",
  }),
  settled({
    id: "job-2",
    locator: "job://bash-2",
    state: "failed",
    intent: "Running the API integration suite",
    command: "pnpm --filter api test:integration",
    exitCode: 1,
    settledAt: "2026-11-27T09:03:12.000Z",
    truncated: ["stdout"],
  }),
  settled({
    id: "job-3",
    locator: "job://bash-3",
    state: "cancelled",
    stoppedBy: "owner",
    signal: "SIGTERM",
    settledAt: "2026-11-27T09:01:30.000Z",
  }),
  settled({
    id: "job-4",
    locator: "job://bash-4",
    state: "timed_out",
    intent: "Watching the web dev server",
    settledAt: "2026-11-27T11:00:00.000Z",
  }),
  settled({
    id: "job-5",
    locator: "job://bash-5",
    state: "lost",
    intent: "Building the machine bundle",
    outcomeUnknown: true,
    settledAt: "2026-11-27T09:00:40.000Z",
  }),
];

const meta = {
  title: "Chat/Session details/Finished jobs panel",
  component: FinishedJobsPanel,
  args: { jobs: JOBS, onClose: fn() },
  // In the app the panel is the outer column of the widened details sidebar,
  // whose provider sets its width; this frame sets the same width and gives
  // it the screen's height.
  decorators: [
    (Story) => (
      <div className="ml-auto flex h-144" style={PANEL_WIDTH}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FinishedJobsPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The latest settlement leads; a row opens on its outcome and record. */
export const Outcomes: Story = {
  play: async ({ canvas }) => {
    const rows = canvas.getAllByRole("button", { expanded: false });

    await expect(rows[0]).toHaveTextContent("Watching the web dev server");
    await expect(rows[0]).toHaveTextContent("2h 00m");

    const failed = canvas.getByRole("button", {
      name: /Running the API integration suite/,
    });

    await userEvent.click(failed);
    await expect(failed).toHaveAttribute("aria-expanded", "true");

    const record = within(failed.parentElement ?? canvas.getByRole("list"));

    await expect(await record.findByText("Failed · exit 1")).toBeVisible();
    await expect(record.getByText("job://bash-2")).toBeVisible();
    await expect(record.getByText("stdout")).toBeVisible();
  },
};

/** A job whose call carried no intent goes by its locator. */
export const StoppedJobWithoutIntent: Story = {
  args: { jobs: JOBS.slice(2, 3) },
  play: async ({ canvas }) => {
    const row = canvas.getByRole("button", { name: /job:\/\/bash-3/ });

    await userEvent.click(row);
    await expect(
      await canvas.findByText("Stopped by you · SIGTERM"),
    ).toBeVisible();
  },
};

/** Escape and the close control both close the panel. */
export const Closes: Story = {
  play: async ({ args, canvas }) => {
    await expect(canvas.getByRole("complementary")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect(args.onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(
      canvas.getByRole("button", { name: "Close finished jobs" }),
    );
    await expect(args.onClose).toHaveBeenCalledTimes(2);
  },
};

export const Empty: Story = { args: { jobs: [] } };
