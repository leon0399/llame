import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, waitFor, within } from "storybook/test";

import {
  MediaThumbnailRow,
  type MediaThumbnailItem,
  type MediaThumbnailRowProps,
} from "./media-thumbnail.js";

/** A solid square with a letter, as a self-contained data URL. */
function swatch(letter: string, fill: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${fill}"/><text x="48" y="62" font-size="44" text-anchor="middle" fill="white" font-family="sans-serif">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const A: MediaThumbnailItem = {
  key: "a",
  kind: "image",
  src: swatch("A", "#2563eb"),
  alt: "a.png",
};
const B: MediaThumbnailItem = {
  key: "b",
  kind: "image",
  src: swatch("B", "#16a34a"),
  alt: "b.png",
};
const C: MediaThumbnailItem = {
  key: "c",
  kind: "image",
  src: swatch("C", "#9333ea"),
  alt: "c.png",
};

const meta = {
  component: MediaThumbnailRow,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  args: {
    items: [A, B, C],
    "aria-label": "Attachments",
    onRemove: fn(),
    onRetry: fn(),
  },
} satisfies Meta<typeof MediaThumbnailRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Applies `onRemove` and `onRetry` (the tile goes back to `uploading`) to
 *  local state so edit stories show the result. */
function EditableRow(args: MediaThumbnailRowProps) {
  const [items, setItems] = React.useState(args.items);
  return (
    <MediaThumbnailRow
      {...args}
      items={items}
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
 * tile can be removed. Tiles keep the order they were added in.
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
 * file again; the overlay then gives way to the upload spinner.
 *
 * @summary for an attachment whose upload failed
 */
export const FailedWithRetry: Story = {
  tags: ["ai-generated"],
  args: { items: [A, { ...B, status: "failed" }] },
  render: (args) => <EditableRow {...args} />,
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByText("Upload failed")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Retry upload" }));
    await expect(args.onRetry).toHaveBeenCalledWith("b");
    await expect(
      canvas.queryByRole("button", { name: "Retry upload" }),
    ).toBeNull();
    await expect(
      canvas.getByRole("status", { name: "Uploading" }),
    ).toBeInTheDocument();
  },
};

/**
 * Keyboard users reach a tile's remove action with Tab: it becomes visible
 * on focus and removes that tile when activated.
 *
 * @summary for removing an attachment with the keyboard
 */
export const KeyboardRemove: Story = {
  tags: ["ai-generated"],
  render: (args) => <EditableRow {...args} />,
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const remove = canvas.getByRole("button", { name: "Remove b.png" });
    await expect(remove).toHaveStyle({ opacity: "0" });
    canvas.getByRole("button", { name: "Remove a.png" }).focus();
    await userEvent.tab();
    await expect(remove).toHaveFocus();
    await waitFor(() => expect(remove).toHaveStyle({ opacity: "1" }));
    await userEvent.keyboard("{Enter}");
    await expect(args.onRemove).toHaveBeenCalledWith("b");
    await expect(imageOrder(canvasElement)).toEqual(["a.png", "c.png"]);
  },
};

/**
 * A sent message shows its images read-only: no remove or retry, and each
 * image loads lazily.
 *
 * @summary for the images of a sent message
 */
export const ReadOnly: Story = {
  tags: ["ai-generated"],
  args: {
    "aria-label": "Message images",
    onRemove: undefined,
    onRetry: undefined,
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
  },
};

/**
 * A stored PDF opens its original in a new tab without loading an image.
 * @summary a stored PDF attachment
 */
export const StoredPdf: Story = {
  tags: ["ai-generated"],
  args: {
    items: [
      {
        key: "paper",
        kind: "pdf",
        name: "paper.pdf",
        href: "/api/v1/media/0192f3a4-5b6c-7d8e-9f01-00000000000a/original",
      },
    ],
    onRemove: undefined,
    onRetry: undefined,
  },
  play: async ({ canvas }) => {
    const link = canvas.getByRole("link", {
      name: "Open paper.pdf in a new tab",
    });
    await expect(link.getAttribute("href")).toMatch(/\/original$/);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(canvas.queryByRole("img")).toBeNull();
  },
};

/**
 * A sent message's cards: each previews its image, or a document icon for a
 * PDF, above the file name. The image card opens the viewer and the PDF card
 * links its original; the visible name does not repeat in either's
 * accessible name.
 *
 * @summary sent-message attachments as cards with their file names
 */
export const Cards: Story = {
  tags: ["ai-generated"],
  args: {
    variant: "card",
    onOpen: fn(),
    items: [
      A,
      {
        key: "paper",
        kind: "pdf",
        name: "paper.pdf",
        href: "/api/v1/media/0192f3a4-5b6c-7d8e-9f01-00000000000a/original",
      },
    ],
    onRemove: undefined,
    onRetry: undefined,
  },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByText("a.png")).toBeVisible();
    await expect(canvas.getByText("paper.pdf")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "a.png" }));
    await expect(args.onOpen).toHaveBeenCalledWith("a");
    await expect(
      canvas.getByRole("link", { name: "Open paper.pdf in a new tab" }),
    ).toHaveAttribute("target", "_blank");
  },
};

/**
 * A PDF card with no original link (unstored, or an upload still in flight)
 * has no link label to name it, so its caption stays exposed as its name.
 *
 * @summary an unlinked PDF card is named by its caption
 */
export const UnlinkedPdfCard: Story = {
  tags: ["ai-generated"],
  args: {
    variant: "card",
    items: [{ key: "local", kind: "pdf", name: "local.pdf" }],
    onRemove: undefined,
    onRetry: undefined,
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("link")).toBeNull();
    await expect(canvas.getByText("local.pdf")).not.toHaveAttribute(
      "aria-hidden",
    );
  },
};

/**
 * A PDF held only by a Run has no original route and remains a static tile.
 * @summary an unstored PDF attachment
 */
export const UnstoredPdf: Story = {
  tags: ["ai-generated"],
  args: {
    items: [{ key: "local", kind: "pdf", name: "local.pdf" }],
    onRemove: undefined,
    onRetry: undefined,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("local.pdf")).toBeVisible();
    await expect(canvas.queryByRole("link")).toBeNull();
    await expect(canvas.queryByRole("button")).toBeNull();
    await expect(canvas.queryByRole("img")).toBeNull();
  },
};

/**
 * An unfinished PDF upload cannot activate an original link.
 * @summary a PDF upload in progress
 */
export const PdfUploading: Story = {
  tags: ["ai-generated"],
  args: {
    items: [
      {
        key: "pending",
        kind: "pdf",
        name: "pending.pdf",
        href: "/pending/original",
        status: "uploading",
      },
    ],
    onRemove: undefined,
    onRetry: undefined,
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("status", { name: "Uploading" }),
    ).toBeVisible();
    await expect(canvas.queryByRole("link")).toBeNull();
  },
};
