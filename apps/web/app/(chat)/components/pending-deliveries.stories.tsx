import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, within } from "storybook/test";

import type { ChatDeliveryResponse } from "@/lib/api/generated/models";
import { PendingDeliveries } from "./pending-deliveries";

function item(
  id: string,
  mode: ChatDeliveryResponse["mode"],
  text: string,
): ChatDeliveryResponse {
  return {
    id,
    chatId: "chat-1",
    producer: "owner",
    mode,
    state: "pending",
    parts: [{ type: "text", text }],
    modelId: "system:openai:model-one",
    permissionMode: "default",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const meta = {
  component: PendingDeliveries,
  tags: ["autodocs"],
  args: {
    items: [],
    paused: false,
    onSteerNow: fn(),
    onInterruptNow: fn(),
    onDelete: fn(),
    onEdit: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-3xl">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "padded" },
} satisfies Meta<typeof PendingDeliveries>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * A queue item offers every action: steer it now, interrupt now, edit, and
 * delete. Each action reports the item it belongs to.
 *
 * @summary queue rows offer Steer now, Interrupt now, Edit, and Delete
 */
export const QueueRow: Story = {
  tags: ["ai-generated"],
  args: { items: [item("q1", "queue", "summarise it afterwards")] },
  play: async ({ args, canvas, userEvent }) => {
    const row = within(canvas.getByRole("listitem"));
    await expect(row.getByText("Queued")).toBeVisible();

    await userEvent.click(row.getByRole("button", { name: /^Steer now/ }));
    await expect(args.onSteerNow).toHaveBeenCalledWith(args.items[0]);
    await userEvent.click(row.getByRole("button", { name: /^Interrupt now/ }));
    await expect(args.onInterruptNow).toHaveBeenCalledWith(args.items[0]);
    await userEvent.click(row.getByRole("button", { name: /^Edit/ }));
    await expect(args.onEdit).toHaveBeenCalledWith(args.items[0]);
    await userEvent.click(row.getByRole("button", { name: /^Delete/ }));
    await expect(args.onDelete).toHaveBeenCalledWith(args.items[0]);
  },
};

/**
 * A steer item is already on its way to the Run, so it offers Interrupt now,
 * Edit, and Delete, and no Steer now.
 *
 * @summary steer rows offer Interrupt now, Edit, and Delete
 */
export const SteerRow: Story = {
  tags: ["ai-generated"],
  args: { items: [item("s1", "steer", "use the other table")] },
  play: async ({ canvas }) => {
    const row = within(canvas.getByRole("listitem"));
    await expect(row.getByText("Steer")).toBeVisible();
    await expect(row.queryByRole("button", { name: /^Steer now/ })).toBeNull();
    await expect(
      row.getByRole("button", { name: /^Interrupt now/ }),
    ).toBeVisible();
  },
};

/**
 * An interrupt item is already stopping the step; the owner can still edit or
 * delete it before the Run delivers it.
 *
 * @summary interrupt rows offer Edit and Delete only
 */
export const InterruptRow: Story = {
  tags: ["ai-generated"],
  args: { items: [item("i1", "interrupt", "stop and do this")] },
  play: async ({ canvas }) => {
    const row = within(canvas.getByRole("listitem"));
    await expect(
      row.queryByRole("button", { name: /^Interrupt now/ }),
    ).toBeNull();
    await expect(row.queryByRole("button", { name: /^Steer now/ })).toBeNull();
    await expect(row.getByRole("button", { name: /^Edit/ })).toBeVisible();
    await expect(row.getByRole("button", { name: /^Delete/ })).toBeVisible();
  },
};

/**
 * Rows keep delivery order, and a message that is only attachments shows how
 * many.
 *
 * @summary rows keep order; an attachment-only item shows its count
 */
export const OrderedRows: Story = {
  tags: ["ai-generated"],
  args: {
    items: [
      item("s1", "steer", "first in line"),
      item("q1", "queue", "second in line"),
      {
        ...item("q2", "queue", ""),
        parts: [
          {
            type: "file",
            url: "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a8b",
            mediaType: "image/png",
          },
        ],
      },
    ],
  },
  play: async ({ canvas }) => {
    const rows = canvas.getAllByRole("listitem");
    await expect(rows).toHaveLength(3);
    await expect(rows[0]).toHaveTextContent("first in line");
    await expect(rows[1]).toHaveTextContent("second in line");
    await expect(rows[2]).toHaveTextContent("1 attachment");
    // Each row's buttons name their item, so rows stay apart.
    await expect(
      within(rows[0]!).getByRole("button", { name: "Edit: first in line" }),
    ).toBeVisible();
    await expect(
      within(rows[1]!).getByRole("button", { name: "Edit: second in line" }),
    ).toBeVisible();
  },
};

/**
 * With no live Run nothing delivers on its own, and the stack says so.
 *
 * @summary a paused queue is labelled
 */
export const Paused: Story = {
  tags: ["ai-generated"],
  args: {
    paused: true,
    items: [item("q1", "queue", "first"), item("q2", "queue", "second")],
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText(/Paused — nothing runs until you send or steer an item/),
    ).toBeVisible();
  },
};

/**
 * No pending items, no stack.
 *
 * @summary an empty list renders nothing
 */
export const Empty: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("region")).toBeNull();
  },
};

/**
 * A job notice names its job and state, with delete as its only action.
 *
 * @summary a job notice names its job and state, with delete as its only action
 */
export const JobNotice: Story = {
  args: {
    paused: true,
    items: [
      {
        ...item("notice-1", "notice", ""),
        producer: "job",
        parts: [],
        job: "job://bash-7",
        jobState: "failed",
      },
    ],
  },
  play: async ({ args, canvas, userEvent }) => {
    const row = within(canvas.getByRole("listitem"));
    await expect(row.getByText("job://bash-7 failed")).toBeVisible();
    await expect(row.queryByRole("button", { name: /^Steer now/ })).toBeNull();
    await expect(
      row.queryByRole("button", { name: /^Interrupt now/ }),
    ).toBeNull();
    await expect(row.queryByRole("button", { name: /^Edit/ })).toBeNull();
    await expect(canvas.queryByText(/^Paused/)).toBeNull();
    await userEvent.click(row.getByRole("button", { name: /^Delete/ }));
    await expect(args.onDelete).toHaveBeenCalledWith(args.items[0]);
  },
};
