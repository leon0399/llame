import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fireEvent, fn, waitFor, within } from "storybook/test";

import {
  ImageThumbnailRow,
  type ImageThumbnailItem,
  type ImageThumbnailRowProps,
} from "./image-thumbnail.js";

/** A solid square with a letter, as a self-contained data URL. */
function swatch(letter: string, fill: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${fill}"/><text x="48" y="62" font-size="44" text-anchor="middle" fill="white" font-family="sans-serif">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const A: ImageThumbnailItem = {
  key: "a",
  src: swatch("A", "#2563eb"),
  alt: "a.png",
};
const B: ImageThumbnailItem = {
  key: "b",
  src: swatch("B", "#16a34a"),
  alt: "b.png",
};
const C: ImageThumbnailItem = {
  key: "c",
  src: swatch("C", "#9333ea"),
  alt: "c.png",
};

const meta = {
  component: ImageThumbnailRow,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  args: {
    items: [A, B, C],
    "aria-label": "Attached images",
    onRemove: fn(),
    onRetry: fn(),
    onReorder: fn(),
  },
} satisfies Meta<typeof ImageThumbnailRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Applies `onReorder`, `onRemove`, and `onRetry` (the tile goes back to
 *  `uploading`) to local state so edit stories show the result. */
function EditableRow(args: ImageThumbnailRowProps) {
  const [items, setItems] = React.useState(args.items);
  return (
    <ImageThumbnailRow
      {...args}
      items={items}
      onReorder={(from, to) => {
        args.onReorder?.(from, to);
        setItems((current) => {
          const next = [...current];
          const [moved] = next.splice(from, 1);
          if (moved) next.splice(to, 0, moved);
          return next;
        });
      }}
      onRemove={(key) => {
        args.onRemove?.(key);
        setItems((current) => current.filter((item) => item.key !== key));
      }}
      onRetry={(key) => {
        args.onRetry?.(key);
        setItems((current) =>
          current.map((item) =>
            item.key === key ? { ...item, status: "uploading" as const } : item,
          ),
        );
      }}
    />
  );
}

function imageOrder(canvasElement: HTMLElement): Array<string> {
  return within(canvasElement)
    .getAllByRole("img")
    .map((image) => image.getAttribute("alt") ?? "");
}

/**
 * Use the editable row in the composer once every upload has finished: each
 * tile can be removed, and the row can be reordered.
 *
 * @summary for uploaded composer attachments
 */
export const Basic: Story = {
  tags: ["ai-generated"],
};

/**
 * While an upload is in flight its tile is covered by an indeterminate
 * progress overlay.
 *
 * @summary for an attachment whose upload is in flight
 */
export const Uploading: Story = {
  tags: ["ai-generated"],
  args: { items: [{ ...A, status: "uploading" }, B] },
  play: async ({ canvas }) => {
    const tiles = canvas.getAllByRole("listitem");
    await expect(
      within(tiles[0]!).getByRole("status", { name: "Uploading" }),
    ).toBeInTheDocument();
    await expect(within(tiles[1]!).queryByRole("status")).toBeNull();
  },
};

/**
 * A failed upload shows an error overlay whose retry action uploads the same
 * file again; keyboard focus stays on the retried tile once the overlay
 * gives way to the upload spinner.
 *
 * @summary for an attachment whose upload failed
 */
export const FailedWithRetry: Story = {
  tags: ["ai-generated"],
  args: { items: [A, { ...B, status: "failed" }] },
  render: (args) => <EditableRow {...args} />,
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByText("Upload failed")).toBeInTheDocument();
    canvas.getByRole("button", { name: "b.png" }).focus();
    await userEvent.tab();
    await expect(
      canvas.getByRole("button", { name: "Retry upload" }),
    ).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onRetry).toHaveBeenCalledWith("b");
    await expect(
      canvas.queryByRole("button", { name: "Retry upload" }),
    ).toBeNull();
    await expect(canvas.getByRole("button", { name: "b.png" })).toHaveFocus();
  },
};

/**
 * Keyboard users reach the remove action by focusing a tile: it becomes
 * visible on focus and removes that tile when activated. Focus then moves to
 * the next tile, or to the previous one when the last tile goes.
 *
 * @summary for removing an attachment with the keyboard
 */
export const KeyboardRemove: Story = {
  tags: ["ai-generated"],
  render: (args) => <EditableRow {...args} />,
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const remove = canvas.getByRole("button", { name: "Remove b.png" });
    await expect(remove).toHaveStyle({ opacity: "0" });
    canvas.getByRole("button", { name: "b.png" }).focus();
    await waitFor(() => expect(remove).toHaveStyle({ opacity: "1" }));
    await userEvent.tab();
    await expect(remove).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onRemove).toHaveBeenCalledWith("b");
    await expect(imageOrder(canvasElement)).toEqual(["a.png", "c.png"]);
    await expect(canvas.getByRole("button", { name: "c.png" })).toHaveFocus();

    await userEvent.tab();
    await expect(
      canvas.getByRole("button", { name: "Remove c.png" }),
    ).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(imageOrder(canvasElement)).toEqual(["a.png"]);
    await expect(canvas.getByRole("button", { name: "a.png" })).toHaveFocus();
  },
};

/**
 * `Alt+ArrowLeft` and `Alt+ArrowRight` move the focused tile one position and
 * keep focus on it.
 *
 * @summary for reordering attachments with the keyboard
 */
export const KeyboardReorder: Story = {
  tags: ["ai-generated"],
  render: (args) => <EditableRow {...args} />,
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    canvas.getByRole("button", { name: "b.png" }).focus();
    await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    await expect(args.onReorder).toHaveBeenLastCalledWith(1, 0);
    await expect(imageOrder(canvasElement)).toEqual([
      "b.png",
      "a.png",
      "c.png",
    ]);
    await expect(canvas.getByRole("button", { name: "b.png" })).toHaveFocus();

    await userEvent.keyboard("{Alt>}{ArrowRight}{ArrowRight}{/Alt}");
    await expect(imageOrder(canvasElement)).toEqual([
      "a.png",
      "c.png",
      "b.png",
    ]);
    await expect(canvas.getByRole("button", { name: "b.png" })).toHaveFocus();

    // The last tile has nowhere further right to go.
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await expect(args.onReorder).toHaveBeenCalledTimes(3);
  },
};

/**
 * Pointer users drag a tile onto another tile's position.
 *
 * @summary for reordering attachments by dragging
 */
export const DragReorder: Story = {
  tags: ["ai-generated"],
  render: (args) => <EditableRow {...args} />,
  play: async ({ args, canvas, canvasElement }) => {
    const [first, , third] = canvas.getAllByRole("listitem");
    const dataTransfer = new DataTransfer();
    fireEvent.dragStart(first!, { dataTransfer });
    fireEvent.dragOver(third!, { dataTransfer });
    fireEvent.drop(third!, { dataTransfer });
    fireEvent.dragEnd(first!, { dataTransfer });
    await expect(args.onReorder).toHaveBeenCalledWith(0, 2);
    await expect(imageOrder(canvasElement)).toEqual([
      "b.png",
      "c.png",
      "a.png",
    ]);
  },
};

/**
 * A sent message shows its images read-only: no remove, retry, or reorder,
 * and each image loads lazily.
 *
 * @summary for the images of a sent message
 */
export const ReadOnly: Story = {
  tags: ["ai-generated"],
  args: {
    "aria-label": "Message images",
    onRemove: undefined,
    onRetry: undefined,
    onReorder: undefined,
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.queryAllByRole("button")).toHaveLength(0);
    await expect(imageOrder(canvasElement)).toEqual([
      "a.png",
      "b.png",
      "c.png",
    ]);
    for (const image of canvas.getAllByRole("img")) {
      await expect(image).toHaveAttribute("loading", "lazy");
    }
    await expect(canvas.getAllByRole("listitem")[0]).not.toHaveAttribute(
      "draggable",
    );
  },
};
