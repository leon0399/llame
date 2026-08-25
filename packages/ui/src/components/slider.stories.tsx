import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent } from "storybook/test";

import { Slider } from "./slider.js";

// `Basic`, `Range`, `Vertical`, and `Disabled` are `shadcn-example`,
// transcribed from the shadcn Slider docs examples
// (https://ui.shadcn.com/docs/components/slider): `Basic` from the default
// demo at the top of the page, `Range` from the two-thumb demo, `Vertical`
// from the "Vertical" section, and `Disabled` from the "Disabled" section.
// `SteppedChoices` is an original showing the index-driven pattern this repo
// uses for a small ordered set of named options.

const meta = {
  component: Slider,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The default single-thumb slider. Use it for a continuous quantity where any
 * value in the range is meaningful — volume, opacity, a threshold.
 *
 * @summary for picking one value from a continuous range
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: { defaultValue: [50], max: 100, step: 1, "aria-label": "Volume" },
};

/**
 * Two thumbs bound a range. Use it when the user selects an interval — a price
 * band, a date window — rather than a single point.
 *
 * @summary for selecting an interval with two thumbs
 */
export const Range: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    defaultValue: [25, 75],
    max: 100,
    step: 1,
    "aria-label": "Price range",
  },
};

/**
 * Vertical orientation, for space-constrained controls that read naturally
 * bottom-to-top such as a level or gain fader.
 *
 * @summary for a bottom-to-top control in narrow space
 */
export const Vertical: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    defaultValue: [40],
    max: 100,
    step: 1,
    orientation: "vertical",
    "aria-label": "Level",
  },
  decorators: [
    (Story) => (
      <div className="h-48">
        <Story />
      </div>
    ),
  ],
};

/**
 * Disabled communicates that the value is currently fixed. Prefer it over
 * hiding the control, so the user can still read the value that applies.
 *
 * @summary for a value the user cannot currently change
 */
export const Disabled: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    defaultValue: [30],
    max: 100,
    step: 1,
    disabled: true,
    "aria-label": "Opacity",
  },
};

/**
 * Driving the slider by INDEX turns it into a picker for a small ordered set
 * of named options — the shape the composer's reasoning-effort control uses.
 * A slider is the right primitive here precisely because the options lie on
 * one scale; a select would not say that.
 *
 * Keyboard support comes from the primitive: arrows step, Home/End jump.
 *
 * @summary for a small ordered set of named choices, addressed by index
 */
export const SteppedChoices: Story = {
  tags: ["ai-generated"],
  args: {
    defaultValue: [2],
    min: 0,
    max: 4,
    step: 1,
    "aria-label": "Reasoning effort",
  },
  play: async ({ canvas }) => {
    const slider = canvas.getByRole("slider");
    await expect(slider).toHaveValue("2");

    slider.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(slider).toHaveValue("3");

    // Home/End jump to the ends of the scale, so a user can reach the extremes
    // without stepping through every option.
    await userEvent.keyboard("{Home}");
    await expect(slider).toHaveValue("0");
  },
};
