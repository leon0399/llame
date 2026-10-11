import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen, waitFor, within } from "storybook/test";

import { Button } from "@workspace/ui/components/button";

import {
  ImageDimensionsTile,
  MediaLightbox,
  type MediaLightboxProps,
  type MediaLightboxSlide,
  mediaCaption,
} from "./media-lightbox.js";

/** A labelled placeholder image of the given size, as a data URL. */
function placeholderImage(width: number, height: number, label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#e4e4e7"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(height / 8)}" fill="#18181b">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const SCREENSHOT_LOCATOR = "media://0199d1c4-5e6f-7a8b-9c0d-1e2f3a4b5c6d";

/** A stored attachment: its original, captioned with the locator alone. */
const screenshot = {
  key: "0",
  src: placeholderImage(4000, 3000, "original 4000×3000"),
  alt: "Dashboard screenshot",
  caption: mediaCaption(SCREENSHOT_LOCATOR),
} satisfies MediaLightboxSlide;

/** An unstored 1600×900 PNG shown from its 256×144 inline thumbnail. */
const shot = {
  key: "1",
  src: placeholderImage(256, 144, "thumbnail"),
  alt: "Read shot",
  caption: mediaCaption("docs/shot.png", {
    width: 1600,
    height: 900,
    mediaType: "image/png",
  }),
} satisfies MediaLightboxSlide;

/** Thumbnail-style openers plus the lightbox, controlled by the open key;
 *  focus returns to whichever opener was activated. */
function LightboxWithOpeners(args: MediaLightboxProps) {
  const [openKey, setOpenKey] = useState(args.openKey);
  return (
    <div className="flex gap-2">
      {args.slides.map((slide) => (
        <Button
          key={slide.key}
          variant="outline"
          onClick={() => setOpenKey(slide.key)}
        >
          Open {slide.alt}
        </Button>
      ))}
      <MediaLightbox
        {...args}
        openKey={openKey}
        onOpenKeyChange={(key) => {
          setOpenKey(key);
          args.onOpenKeyChange(key);
        }}
      />
    </div>
  );
}

const meta = {
  component: MediaLightbox,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  args: { slides: [screenshot, shot], openKey: null, onOpenKeyChange: fn() },
  argTypes: { openKey: { control: false } },
  render: (args) => <LightboxWithOpeners {...args} />,
} satisfies Meta<typeof MediaLightbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The open lightbox, once its fade-in has finished. */
async function openDialog() {
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(dialog).toBeVisible());
  return dialog;
}

/**
 * Use whenever a chat image thumbnail is activated. The lightbox opens on that
 * image with its caption under it; `Escape` closes it and returns focus to the
 * opener.
 *
 * @summary for opening a chat image in a dialog
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    const opener = canvas.getByRole("button", {
      name: "Open Dashboard screenshot",
    });
    await userEvent.click(opener);
    const dialog = await openDialog();
    await expect(dialog).toHaveAccessibleName("Dashboard screenshot");
    await expect(dialog).toHaveAccessibleDescription(SCREENSHOT_LOCATOR);
    await expect(
      within(dialog).getByRole("img", { name: "Dashboard screenshot" }),
    ).toHaveAttribute("src", screenshot.src);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  },
};

/**
 * The arrow keys and the previous/next buttons move within the row and stop
 * at its ends, where the button stays focusable but does nothing.
 *
 * @summary for moving between a row's images
 */
export const Navigation: Story = {
  tags: ["ai-generated"],
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open Dashboard screenshot" }),
    );
    const dialog = await openDialog();
    const previous = within(dialog).getByRole("button", {
      name: "Previous image",
    });
    const next = within(dialog).getByRole("button", { name: "Next image" });
    await expect(previous).toHaveAttribute("aria-disabled", "true");

    await userEvent.keyboard("{ArrowRight}");
    await expect(args.onOpenKeyChange).toHaveBeenLastCalledWith("1");
    await waitFor(() =>
      expect(dialog).toHaveAccessibleDescription(
        "1600×900 PNG · docs/shot.png",
      ),
    );
    await expect(next).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(previous);
    await waitFor(() =>
      expect(dialog).toHaveAccessibleDescription(SCREENSHOT_LOCATOR),
    );
  },
};

/**
 * Stepping onto the row's last image with the next button keeps focus on
 * that button, now a no-op, so the arrow keys still move within the row.
 *
 * @summary for keyboard focus at a row's end
 */
export const FocusAtRowEnd: Story = {
  tags: ["ai-generated"],
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open Dashboard screenshot" }),
    );
    const dialog = await openDialog();
    const next = within(dialog).getByRole("button", { name: "Next image" });

    await userEvent.click(next);
    await waitFor(() =>
      expect(dialog).toHaveAccessibleDescription(
        "1600×900 PNG · docs/shot.png",
      ),
    );
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect(next).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    await expect(args.onOpenKeyChange).toHaveBeenCalledTimes(1);
    await expect(dialog.contains(dialog.ownerDocument.activeElement)).toBe(
      true,
    );

    await userEvent.keyboard("{ArrowLeft}");
    await expect(args.onOpenKeyChange).toHaveBeenLastCalledWith("0");
    await waitFor(() =>
      expect(dialog).toHaveAccessibleDescription(SCREENSHOT_LOCATOR),
    );
  },
};

/**
 * Clicking the image, or the "Actual size" button, toggles between fitting
 * the viewport and the image's natural size, where the panel scrolls to pan.
 *
 * @summary for zooming an image to 100%
 */
export const ActualSize: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open Dashboard screenshot" }),
    );
    const dialog = await openDialog();
    const toggle = within(dialog).getByRole("button", { name: "Actual size" });
    const image = within(dialog).getByRole("img", {
      name: "Dashboard screenshot",
    });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(image);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(image).toHaveClass("max-w-none");

    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(image).not.toHaveClass("max-w-none");
  },
};

/**
 * A row of one image has no previous or next buttons.
 *
 * @summary for a single image
 */
export const SingleImage: Story = {
  tags: ["ai-generated"],
  args: { slides: [shot] },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open Read shot" }),
    );
    const dialog = await openDialog();
    await expect(
      within(dialog).queryByRole("button", { name: "Next image" }),
    ).toBeNull();
    await expect(
      within(dialog).getByRole("button", { name: "Close" }),
    ).toBeVisible();
  },
};

/**
 * An image with no thumbnail to show (its inline thumbnail would have
 * exceeded the cap) gets a tile naming its size and format; it opens nothing.
 *
 * @summary for an image shown by its size only
 */
export const DimensionsTile: StoryObj<typeof ImageDimensionsTile> = {
  tags: ["ai-generated"],
  render: () => (
    <ImageDimensionsTile width={8000} height={6000} mediaType="image/png" />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("8000×6000 PNG")).toBeVisible();
  },
};
