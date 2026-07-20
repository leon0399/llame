import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ScrollArea, ScrollBar } from "./scroll-area.js";
import { Separator } from "./separator.js";

// Both stories here are transcribed from the shadcn Scroll Area docs examples
// (https://ui.shadcn.com/docs/components/radix/scroll-area), so the file
// carries the "shadcn-example" provenance tag on each transcribed story. Adaptations
// are limited to the import path and swapping `next/image` for a plain
// `<img>` (the horizontal demo). No other upstream examples exist for this
// component beyond RTL, which is skipped by convention.
const meta = {
  component: ScrollArea,
  subcomponents: { ScrollBar },
  parameters: {
    layout: "centered",
    // The Radix ScrollArea viewport is a scrollable region without its own
    // focusable content, which axe's scrollable-region-focusable rule flags
    // as a false positive here — same known-Radix-primitive pattern already
    // disabled in select.stories.tsx.
    a11y: {
      config: {
        rules: [{ id: "scrollable-region-focusable", enabled: false }],
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ScrollArea>;

export default meta;

type Story = StoryObj<typeof meta>;

const tags = Array.from({ length: 50 }).map(
  (_, i, a) => `v1.2.0-beta.${a.length - i}`,
);

/**
 * Use ScrollArea to constrain long content (like this tag list) to a fixed
 * box with a custom-styled vertical scrollbar instead of the OS default.
 *
 * Verbatim from [shadcn Scroll Area](https://ui.shadcn.com/docs/components/radix/scroll-area).
 *
 * @summary for the standard fixed-height scrollable box
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    className: "h-72 w-48 rounded-md border",
    children: (
      <div className="p-4">
        <h4 className="mb-4 text-sm leading-none font-medium">Tags</h4>
        {tags.map((tag) => (
          <React.Fragment key={tag}>
            <div className="text-sm">{tag}</div>
            <Separator className="my-2" />
          </React.Fragment>
        ))}
      </div>
    ),
  },
};

interface Artwork {
  artist: string;
  art: string;
}

const works: Artwork[] = [
  {
    artist: "Ornella Binni",
    art: "https://images.unsplash.com/photo-1465869185982-5a1a7522cbcb?auto=format&fit=crop&w=300&q=80",
  },
  {
    artist: "Tom Byrom",
    art: "https://images.unsplash.com/photo-1548516173-3cabfa4607e9?auto=format&fit=crop&w=300&q=80",
  },
  {
    artist: "Vladimir Malyavko",
    art: "https://images.unsplash.com/photo-1494337480532-3725c85fd2ab?auto=format&fit=crop&w=300&q=80",
  },
];

/**
 * Use `ScrollBar` with `orientation="horizontal"` for a horizontally
 * scrolling row of content, such as this artwork strip. Adapted to a plain
 * `<img>` (upstream uses `next/image`).
 *
 * Adapted from [shadcn Scroll Area › Horizontal](https://ui.shadcn.com/docs/components/radix/scroll-area#horizontal).
 *
 * @summary for a horizontally scrolling row of content
 */
export const Horizontal: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    className: "w-96 rounded-md border whitespace-nowrap",
    children: (
      <>
        <div className="flex w-max space-x-4 p-4">
          {works.map((artwork) => (
            <figure key={artwork.artist} className="shrink-0">
              <div className="overflow-hidden rounded-md">
                <img
                  src={artwork.art}
                  alt={`Photo by ${artwork.artist}`}
                  className="aspect-[3/4] h-fit w-fit object-cover"
                  width={300}
                  height={400}
                />
              </div>
              <figcaption className="pt-2 text-xs text-muted-foreground">
                Photo by{" "}
                <span className="font-semibold text-foreground">
                  {artwork.artist}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </>
    ),
  },
};
