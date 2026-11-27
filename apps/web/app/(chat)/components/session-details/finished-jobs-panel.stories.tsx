import type { CSSProperties, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import type { ChatJobResponse } from "@/lib/api/generated/models";
import { chatJobsQueryKeys } from "@/lib/services/jobs/queries";

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

const part = (name: string, content: string, size = content.length) => ({
  name,
  content,
  cut: size > content.length,
  size,
});

/** What the output route answers for each job, keyed by job id. */
const OUTPUTS = {
  "job-1": {
    status: "stored",
    outputs: [
      part("stdout", "abc1234 Update the README\n"),
      part("stderr", ""),
    ],
  },
  "job-2": {
    status: "stored",
    outputs: [
      part(
        "stdout",
        " ✓ chat-jobs (15 tests)\n ✗ job output (1 failed)\n",
        3_355_443,
      ),
      part("stderr", "AssertionError: expected 409 to be 200\n"),
    ],
  },
  "job-3": {
    status: "stored",
    outputs: [part("stdout", ""), part("stderr", "")],
  },
  "job-4": { status: "stored", outputs: [part("stdout", "ready on :3000\n")] },
  "job-5": { status: "unavailable" },
} as const;

/** A client seeded with each job's output, so rows open without a backend. */
function SeededOutputs({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  for (const [jobId, output] of Object.entries(OUTPUTS)) {
    client.setQueryData(chatJobsQueryKeys.output("chat-1", jobId), output);
  }

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const meta = {
  title: "Chat/Session details/Finished jobs panel",
  component: FinishedJobsPanel,
  args: { jobs: JOBS, onClose: fn() },
  // In the app the panel is the outer column of the widened details sidebar,
  // whose provider sets its width; this frame sets the same width and gives
  // it the screen's height.
  decorators: [
    (Story) => (
      <SeededOutputs>
        <div className="ml-auto flex h-144" style={PANEL_WIDTH}>
          <Story />
        </div>
      </SeededOutputs>
    ),
  ],
} satisfies Meta<typeof FinishedJobsPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The panel fades in from opacity 0, and a visibility check reads opacity, so
 * each play waits until the fade ends before it reads anything.
 */
async function panelShown(panel: HTMLElement) {
  await waitFor(() => expect(getComputedStyle(panel).opacity).toBe("1"));
}

/**
 * The default panel: the latest settlement leads, and an open row shows its command, its output with cut captions, and its outcome.
 *
 * @summary finished jobs with command and output
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    await panelShown(canvas.getByRole("complementary"));

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
    await expect(
      record.getByText("$ pnpm --filter api test:integration"),
    ).toBeVisible();
    await expect(
      await record.findByText("last 64 KiB of 3.2 MiB"),
    ).toBeVisible();
    await expect(record.getByText("stderr")).toBeVisible();
    await expect(
      record.getByText("stdout cut at the output bound"),
    ).toBeVisible();
  },
};

/**
 * A job whose call carried no intent goes by its locator; an empty output reads as No output.
 *
 * @summary a stopped job without an intent
 */
export const StoppedJobWithoutIntent: Story = {
  tags: ["ai-generated"],
  args: { jobs: JOBS.slice(2, 3) },
  play: async ({ canvas }) => {
    await panelShown(canvas.getByRole("complementary"));
    await userEvent.click(
      canvas.getByRole("button", { name: /job:\/\/bash-3/ }),
    );
    await expect(
      await canvas.findByText("Stopped by you · SIGTERM"),
    ).toBeVisible();
    await expect(await canvas.findByText("No output")).toBeVisible();
    await expect(canvas.getByText("Command not recorded")).toBeVisible();
  },
};

/**
 * Escape and the close control both close the panel.
 *
 * @summary closing the panel
 */
export const Closes: Story = {
  tags: ["ai-generated"],
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

/**
 * A Chat with no finished jobs.
 *
 * @summary no finished jobs
 */
export const Empty: Story = { tags: ["ai-generated"], args: { jobs: [] } };

/**
 * A lost job stored no output, and its open row says so.
 *
 * @summary a lost job without stored output
 */
export const LostJobWithoutOutput: Story = {
  tags: ["ai-generated"],
  args: { jobs: JOBS.slice(4, 5) },
  play: async ({ canvas }) => {
    await panelShown(canvas.getByRole("complementary"));
    await userEvent.click(
      canvas.getByRole("button", { name: /Building the machine bundle/ }),
    );
    await expect(
      await canvas.findByText("Output was not stored"),
    ).toBeVisible();
  },
};
