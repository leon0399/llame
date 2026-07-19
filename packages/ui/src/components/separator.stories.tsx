import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Separator } from "./separator.js";

// Every story here is transcribed from the shadcn Separator docs examples
// (https://ui.shadcn.com/docs/components/radix/separator), so the file
// carries the "shadcn-example" provenance tag at the meta level. All four
// non-RTL examples (Demo, Vertical, Menu, List) use only the public
// Separator API our component already exports, so none are skipped; RTL is
// excluded by convention.
const meta = {
  component: Separator,
  parameters: {
    layout: "centered",
  },
  // Mirror the docs' ComponentPreview frame: center each example and
  // width-constrain it to a single width. Horizontal separators need a
  // container width to be visible at all, so this frame is load-bearing, not
  // just cosmetic. Verbatim per-example widths (max-w-sm, w-full) are
  // stripped from the story bodies so they all fill this one frame.
  decorators: [
    (Story) => (
      <div className="w-[20rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs", "shadcn-example"],
  argTypes: {
    orientation: {
      control: "select",
      options: ["horizontal", "vertical"],
      description:
        "Layout axis of the separator: horizontal between stacked blocks, vertical between inline items.",
    },
  },
} satisfies Meta<typeof Separator>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The default horizontal separator, dividing a block of related text from
 * unrelated content below it.
 *
 * Adapted from [shadcn Separator demo](https://ui.shadcn.com/docs/components/radix/separator)
 * (the default example at the top of the page, before any heading).
 *
 * @summary for the standard horizontal divider
 */
export const Basic: Story = {
  render: () => (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-1.5">
        <div className="leading-none font-medium">shadcn/ui</div>
        <div className="text-muted-foreground">
          The Foundation for your Design System
        </div>
      </div>
      <Separator />
      <div>
        A set of beautifully designed components that you can customize, extend,
        and build on.
      </div>
    </div>
  ),
};

/**
 * Use `orientation="vertical"` to divide inline items, such as a row of
 * links, instead of stacked blocks.
 *
 * Adapted from [shadcn Separator › Vertical](https://ui.shadcn.com/docs/components/radix/separator#vertical).
 *
 * @summary for a vertical divider between inline items
 */
export const Vertical: Story = {
  render: () => (
    <div className="flex h-5 items-center gap-4 text-sm">
      <div>Blog</div>
      <Separator orientation="vertical" />
      <div>Docs</div>
      <Separator orientation="vertical" />
      <div>Source</div>
    </div>
  ),
};

/**
 * Vertical separators between menu-style items that each carry a label and
 * description, with one hidden below the `md` breakpoint.
 *
 * Adapted from [shadcn Separator › Menu](https://ui.shadcn.com/docs/components/radix/separator#menu).
 *
 * @summary for vertical dividers between menu items with descriptions
 */
export const InMenu: Story = {
  render: () => (
    <div className="flex items-center gap-2 text-sm md:gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-medium">Settings</span>
        <span className="text-xs text-muted-foreground">
          Manage preferences
        </span>
      </div>
      <Separator orientation="vertical" />
      <div className="flex flex-col gap-1">
        <span className="font-medium">Account</span>
        <span className="text-xs text-muted-foreground">
          Profile & security
        </span>
      </div>
      <Separator orientation="vertical" className="hidden md:block" />
      <div className="hidden flex-col gap-1 md:flex">
        <span className="font-medium">Help</span>
        <span className="text-xs text-muted-foreground">Support & docs</span>
      </div>
    </div>
  ),
};

/**
 * Horizontal separators between rows of a key/value list.
 *
 * Adapted from [shadcn Separator › List](https://ui.shadcn.com/docs/components/radix/separator#list).
 *
 * @summary for horizontal dividers between list rows
 */
export const InList: Story = {
  render: () => (
    <div className="flex flex-col gap-2 text-sm">
      <dl className="flex items-center justify-between">
        <dt>Item 1</dt>
        <dd className="text-muted-foreground">Value 1</dd>
      </dl>
      <Separator />
      <dl className="flex items-center justify-between">
        <dt>Item 2</dt>
        <dd className="text-muted-foreground">Value 2</dd>
      </dl>
      <Separator />
      <dl className="flex items-center justify-between">
        <dt>Item 3</dt>
        <dd className="text-muted-foreground">Value 3</dd>
      </dl>
    </div>
  ),
};
