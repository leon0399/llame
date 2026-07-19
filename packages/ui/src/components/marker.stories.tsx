import { InfoIcon } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Marker, MarkerContent, MarkerIcon } from "./marker.js";

// Marker has no upstream shadcn docs example — it is our own component
// (a status-line/divider atom), so every story here carries the
// "ai-generated" provenance tag.
const meta = {
  component: Marker,
  subcomponents: { MarkerIcon, MarkerContent },
  parameters: {
    layout: "centered",
  },
  // Marker renders "w-full"; without a bounding frame the "separator"
  // variant's flanking rules have nothing to grow into.
  decorators: [
    (Story) => (
      <div className="w-[24rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs", "ai-generated"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "separator", "border"],
      description:
        "Visual treatment: plain row, horizontal rules flanking centered content, or a bottom border.",
    },
    asChild: {
      control: false,
      description:
        "Render as a Radix Slot, merging marker styling onto the child element.",
    },
  },
} satisfies Meta<typeof Marker>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use the default variant for a plain status row, such as a system message
 * inline in a chat transcript.
 *
 * @summary for a plain, unadorned status row
 */
export const Basic: Story = {
  args: {
    children: <MarkerContent>Session started</MarkerContent>,
  },
};

/**
 * The three variants together: `default` for a plain row, `separator` for a
 * divider with centered content (e.g. a "model changed" boundary in a chat
 * transcript), and `border` for a row with a bottom rule marking a section
 * boundary.
 *
 * @summary reference of the marker variant scale
 */
export const Variants: Story = {
  // `variant` is fixed per row in this showcase, so its control would be
  // inert here — disable it (the row stays visible, just not editable).
  argTypes: {
    variant: { control: false },
  },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <Marker {...args} variant="default">
        <MarkerContent>Default</MarkerContent>
      </Marker>
      <Marker {...args} variant="separator">
        <MarkerContent>Separator</MarkerContent>
      </Marker>
      <Marker {...args} variant="border">
        <MarkerContent>Border</MarkerContent>
      </Marker>
    </div>
  ),
};

/**
 * Pair `MarkerIcon` with `MarkerContent` for an icon-plus-text row, such as
 * an inline notice alongside its status glyph.
 *
 * @summary for an icon-plus-text marker row
 */
export const IconComposition: Story = {
  args: {
    children: (
      <>
        <MarkerIcon>
          <InfoIcon />
        </MarkerIcon>
        <MarkerContent>New messages since your last visit</MarkerContent>
      </>
    ),
  },
};
