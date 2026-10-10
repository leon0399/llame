import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fireEvent, fn, screen, waitFor } from "storybook/test";

import { Button } from "@workspace/ui/components/button";

import {
  MediaLightbox,
  type MediaLightboxProps,
  type MediaLightboxSlide,
} from "./media-lightbox.js";

/** A labelled placeholder image of the given size, as a data URL. */
function placeholderImage(width: number, height: number, label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#e4e4e7"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(height / 8)}" fill="#18181b">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The spec's toggle fixture: a 4000×3000 JPEG with a 2000×1500 PNG model variant. */
const screenshot: MediaLightboxSlide = {
  original: {
    src: placeholderImage(4000, 3000, "original 4000×3000"),
    width: 4000,
    height: 3000,
    mediaType: "image/jpeg",
  },
  model: {
    src: placeholderImage(2000, 1500, "model 2000×1500"),
    width: 2000,
    height: 1500,
    mediaType: "image/png",
  },
  provenance: "upload",
  locator: "media://0199d1c4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  alt: "Dashboard screenshot",
};

/** An image returned by `read`, small enough to sit inside the viewport. */
const diagramImage = {
  src: placeholderImage(240, 160, "diagram"),
  width: 240,
  height: 160,
  mediaType: "image/png",
};
const diagram: MediaLightboxSlide = {
  original: diagramImage,
  model: diagramImage,
  provenance: "read",
  locator: "media://0199d1c4-6a7b-7c8d-9e0f-2a3b4c5d6e7f",
  alt: "Architecture diagram",
};

/**
 * Thumbnail-style openers plus the lightbox: the lightbox is controlled by
 * an open index, and focus returns to whichever opener was activated.
 */
function LightboxWithOpeners(args: MediaLightboxProps) {
  const [index, setIndex] = useState(args.index);
  return (
    <div className="flex gap-2">
      {args.slides.map((slide, slideIndex) => (
        <Button
          key={slide.locator}
          variant="outline"
          onClick={() => setIndex(slideIndex)}
        >
          Open {slide.alt}
        </Button>
      ))}
      <MediaLightbox
        {...args}
        index={index}
        onClose={() => {
          setIndex(null);
          args.onClose();
        }}
      />
    </div>
  );
}

/** The image the lightbox currently shows (neighbours are preloaded inert). */
function currentImage(): HTMLImageElement {
  const image = document.querySelector<HTMLImageElement>(
    ".yarl__slide_current img",
  );
  if (!image) throw new Error("No current lightbox image");
  return image;
}

const meta = {
  component: MediaLightbox,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  args: { slides: [screenshot, diagram], index: null, onClose: fn() },
  argTypes: { index: { control: false } },
  render: (args) => <LightboxWithOpeners {...args} />,
} satisfies Meta<typeof MediaLightbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Use whenever a chat image thumbnail is activated. The lightbox opens on that
 * image's `model` variant with the variant toggle and caption.
 *
 * @summary for opening a chat image full-screen
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open Dashboard screenshot" }),
    );
    const dialog = await screen.findByRole("dialog");
    // The lightbox fades in from opacity 0; wait until it is shown.
    await waitFor(() => expect(dialog).toBeVisible());
    await waitFor(() =>
      expect(
        screen.getByText(`2000×1500 PNG · upload · ${screenshot.locator}`),
      ).toBeVisible(),
    );
  },
};

/**
 * A plain mouse wheel zooms, even on an image already shown at its natural
 * size because it is smaller than the viewport.
 *
 * @summary for wheel zoom on an image smaller than the viewport
 */
export const WheelZoomOnSmallImage: Story = {
  tags: ["ai-generated"],
  // Zoom animates; the interaction test covers it, a snapshot would not.
  parameters: { visualTests: { disable: true } },
  args: { slides: [diagram] },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open Architecture diagram" }),
    );
    await screen.findByRole("dialog");
    const image = currentImage();
    await waitFor(() => expect(image.complete).toBe(true));
    const zoomWrapper = image.closest<HTMLElement>(".yarl__slide_wrapper");
    if (!zoomWrapper) throw new Error("No zoom wrapper");
    const scale = () =>
      Number(/scale\(([\d.]+)\)/.exec(zoomWrapper.style.transform)?.[1] ?? 1);
    await expect(scale()).toBe(1);

    fireEvent.wheel(image, { deltaY: -200 });

    await waitFor(() => expect(scale()).toBeGreaterThan(1));
  },
};

/**
 * Left and right arrow keys move between every image in the lightbox, in
 * display order.
 *
 * @summary for arrow-key navigation between images
 */
export const ArrowKeyNavigation: Story = {
  tags: ["ai-generated"],
  // Slides animate between positions; the interaction test covers it.
  parameters: { visualTests: { disable: true } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open Dashboard screenshot" }),
    );
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    await expect(currentImage()).toHaveAttribute("alt", screenshot.alt);

    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(currentImage()).toHaveAttribute("alt", diagram.alt),
    );
    await waitFor(() =>
      expect(
        screen.getByText(`240×160 PNG · read · ${diagram.locator}`),
      ).toBeVisible(),
    );

    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() =>
      expect(currentImage()).toHaveAttribute("alt", screenshot.alt),
    );
  },
};

/**
 * Escape closes the lightbox and puts focus back on the thumbnail that opened
 * it, so keyboard users continue where they were.
 *
 * @summary for closing with Escape and restoring focus to the opener
 */
export const EscapeReturnsFocus: Story = {
  tags: ["ai-generated"],
  // Play closes the lightbox, so a snapshot would only show the openers.
  parameters: { visualTests: { disable: true } },
  play: async ({ args, canvas, userEvent }) => {
    const opener = canvas.getByRole("button", {
      name: "Open Architecture diagram",
    });
    await userEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await expect(args.onClose).toHaveBeenCalledOnce();
    await expect(opener).toHaveFocus();
  },
};

/**
 * The segmented control switches the shown bytes between the stored original
 * and the model variant; the caption follows the shown variant.
 *
 * @summary for switching between the original and model variants
 */
export const VariantToggle: Story = {
  tags: ["ai-generated"],
  args: { slides: [screenshot] },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open Dashboard screenshot" }),
    );
    await screen.findByRole("dialog");
    await expect(currentImage()).toHaveAttribute("src", screenshot.model.src);
    await expect(screen.getByRole("button", { name: "Model" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await userEvent.click(screen.getByRole("button", { name: "Original" }));

    await waitFor(() =>
      expect(currentImage()).toHaveAttribute("src", screenshot.original.src),
    );
    await expect(
      screen.getByText(`4000×3000 JPEG · upload · ${screenshot.locator}`),
    ).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Model" }));

    await waitFor(() =>
      expect(currentImage()).toHaveAttribute("src", screenshot.model.src),
    );
    await expect(
      screen.getByText(`2000×1500 PNG · upload · ${screenshot.locator}`),
    ).toBeVisible();
  },
};
