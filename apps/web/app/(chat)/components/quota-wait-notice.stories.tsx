import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor } from "storybook/test";
import { QuotaWaitNotice } from "./quota-wait-notice";

const NOW = Date.parse("2026-11-19T09:00:00.000Z");
const clock = fn(() => NOW);
const stop = fn();

const meta = {
  title: "Chat/Components/QuotaWaitNotice",
  component: QuotaWaitNotice,
  parameters: { layout: "padded" },
  args: {
    modelName: "GPT-5.4",
    pendingStop: false,
    onStop: stop,
    quota: {
      failureClass: "quota_exhausted",
      resetsAt: new Date(NOW + 183_600_000).toISOString(),
      wakeAt: new Date(NOW + 183_675_000).toISOString(),
    },
  },
  beforeEach: () => {
    const original = Date.now;
    clock.mockReturnValue(NOW);
    stop.mockClear();
    Date.now = clock;

    return () => {
      Date.now = original;
    };
  },
  render: function InteractiveNotice(args) {
    const [requestedStop, setRequestedStop] = useState(false);

    return (
      <QuotaWaitNotice
        {...args}
        pendingStop={args.pendingStop || requestedStop}
        onStop={() => {
          args.onStop();
          setRequestedStop(true);
        }}
      />
    );
  },
} satisfies Meta<typeof QuotaWaitNotice>;

export default meta;

type Story = StoryObj<typeof meta>;

export const CodexWeeklyLimit: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("GPT-5.4 usage limit reached")).toBeVisible();
    await expect(canvas.getByText(/in 2 days 3 hours 1 minute/)).toBeVisible();
    await expect(canvas.getByText(/Resets at/)).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Stop waiting for quota reset" }),
    );
    await expect(stop).toHaveBeenCalledOnce();
    await expect(canvas.getByRole("status")).toHaveTextContent("Stopping…");
  },
};

export const RateLimited: Story = {
  args: {
    quota: {
      failureClass: "rate_limited",
      resetsAt: new Date(NOW + 90_000).toISOString(),
      wakeAt: new Date(NOW + 165_000).toISOString(),
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("GPT-5.4 rate limit reached")).toBeVisible();
    await expect(canvas.getByText(/in 2 minutes 45 seconds/)).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Stop waiting for quota reset" }),
    );
    await expect(stop).toHaveBeenCalledOnce();
    await expect(canvas.getByRole("status")).toHaveTextContent("Stopping…");
  },
};

export const WakeTimeReached: Story = {
  args: {
    quota: {
      failureClass: "quota_exhausted",
      resetsAt: new Date(NOW - 60_000).toISOString(),
      wakeAt: new Date(NOW + 2000).toISOString(),
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/in 2 seconds/)).toBeVisible();
    clock.mockReturnValue(NOW + 1000);
    await waitFor(() => expect(canvas.getByText(/in 1 second/)).toBeVisible());
    clock.mockReturnValue(NOW + 2000);
    await expect(canvas.findByText("Sending again…")).resolves.toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Stop waiting for quota reset" }),
    );
    await expect(stop).toHaveBeenCalledOnce();
    await expect(canvas.getByRole("status")).toHaveTextContent("Stopping…");
  },
};
