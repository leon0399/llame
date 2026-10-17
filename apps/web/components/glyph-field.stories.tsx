import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { GlyphField } from "./glyph-field";

const meta = {
  component: GlyphField,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="relative h-120 w-full bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GlyphField>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The new-chat background in the theme's own ink: the base and beam canvases
 * fill the frame, and the field is hidden from assistive tech. Switch the
 * toolbar theme to see it on dark.
 *
 * @summary the glyph field filling its frame
 */
export const Field: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector('[aria-hidden="true"]');
    await expect(host?.querySelectorAll("canvas")).toHaveLength(2);
  },
};
