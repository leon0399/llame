import { BoldIcon, BookmarkIcon, ItalicIcon } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";

import { Toggle } from "./toggle.js";

// Every non-RTL example on the shadcn Toggle docs
// (https://ui.shadcn.com/docs/components/base/toggle) is transcribed
// verbatim below, so the file carries the "shadcn-example" provenance tag at
// the meta level. All five examples (Demo, Outline, With Text, Size,
// Disabled) compose only the public `Toggle` API our toggle.tsx exports, so
// none are skipped for a companion-component gap. RTL (toggle-rtl, the same
// Demo under dir="rtl") is skipped by convention.
const meta = {
  component: Toggle,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "outline"],
      description: "Visual style — transparent by default, or bordered.",
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg"],
      description: "Height and padding of the toggle.",
    },
    pressed: {
      control: "boolean",
      description:
        "Controlled pressed (on) state; pair with `onPressedChange`.",
    },
    defaultPressed: {
      control: "boolean",
      description: "Initial pressed state for an uncontrolled toggle.",
    },
    onPressedChange: {
      control: false,
      description: "Callback fired when the pressed state changes.",
      type: { name: "function", required: false },
    },
    disabled: {
      control: "boolean",
      description: "Whether the toggle is non-interactive.",
    },
  },
  args: {
    onPressedChange: fn(),
  },
} satisfies Meta<typeof Toggle>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The default two-state toggle — bordered, compact, with a leading icon and
 * label. Click (or Space/Enter when focused) toggles the pressed state
 * (`data-pressed` present / absent); screen readers get the same signal via
 * `aria-pressed`.
 *
 * Verbatim from [shadcn Toggle demo](https://ui.shadcn.com/docs/components/base/toggle).
 *
 * @summary for the default single on/off toggle
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    "aria-label": "Toggle bookmark",
    size: "sm",
    variant: "outline",
    children: (
      <>
        <BookmarkIcon className="group-aria-pressed/toggle:fill-foreground" />
        Bookmark
      </>
    ),
  },
  play: async ({ args, canvas, userEvent }) => {
    const toggle = canvas.getByRole("button", { name: "Toggle bookmark" });

    await expect(toggle).toBeInTheDocument();
    await expect(toggle).not.toHaveAttribute("data-pressed");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(toggle);

    await expect(toggle).toHaveAttribute("data-pressed");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(args.onPressedChange).toHaveBeenCalledWith(true, expect.anything());
  },
};

/**
 * Use `variant="outline"` for a bordered toggle that reads clearly against a
 * plain background — e.g. a formatting toolbar with several toggles side by
 * side. Args are spread into every toggle, so the shared controls and
 * Actions panel drive the whole showcase.
 *
 * Verbatim from [shadcn Toggle › Outline](https://ui.shadcn.com/docs/components/base/toggle#outline).
 *
 * @summary for a bordered toggle in a multi-toggle toolbar
 */
export const Outline: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    variant: "outline",
  },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Toggle {...args} aria-label="Toggle italic">
        <ItalicIcon />
        Italic
      </Toggle>
      <Toggle {...args} aria-label="Toggle bold">
        <BoldIcon />
        Bold
      </Toggle>
    </div>
  ),
};

/**
 * A toggle can pair an icon with a text label instead of standing alone —
 * useful wherever the action needs to stay legible without relying on icon
 * recognition alone.
 *
 * Verbatim from [shadcn Toggle › With Text](https://ui.shadcn.com/docs/components/base/toggle#with-text).
 *
 * @summary for a toggle with both icon and text label
 */
export const WithText: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    "aria-label": "Toggle italic",
    children: (
      <>
        <ItalicIcon />
        Italic
      </>
    ),
  },
};

/**
 * The size scale — `sm`, default, and `lg` — for fitting the toggle to
 * denser or roomier layouts. `size` is fixed per toggle in this showcase, so
 * its control would be inert here — disable it (the row stays visible, just
 * not editable).
 *
 * Verbatim from [shadcn Toggle › Size](https://ui.shadcn.com/docs/components/base/toggle#size).
 *
 * @summary reference of the toggle size scale
 */
export const Sizes: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    variant: "outline",
  },
  argTypes: {
    size: { control: false },
  },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Toggle {...args} aria-label="Toggle small" size="sm">
        Small
      </Toggle>
      <Toggle {...args} aria-label="Toggle default" size="default">
        Default
      </Toggle>
      <Toggle {...args} aria-label="Toggle large" size="lg">
        Large
      </Toggle>
    </div>
  ),
};

/**
 * Add `disabled` for a temporarily unavailable toggle — both the default and
 * outline variants stay visually distinguishable while inert to input.
 *
 * Verbatim from [shadcn Toggle › Disabled](https://ui.shadcn.com/docs/components/base/toggle#disabled).
 *
 * @summary for a non-interactive disabled toggle
 */
export const Disabled: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Toggle aria-label="Toggle disabled" disabled>
        Disabled
      </Toggle>
      <Toggle variant="outline" aria-label="Toggle disabled outline" disabled>
        Disabled
      </Toggle>
    </div>
  ),
  play: async ({ canvas }) => {
    const toggles = canvas.getAllByRole("button", {
      name: /toggle disabled/i,
    });

    // `disabled:pointer-events-none` makes these unclickable in a real
    // browser too, so we only assert the resulting state here.
    await expect(toggles).toHaveLength(2);
    for (const toggle of toggles) {
      await expect(toggle).toBeDisabled();
      await expect(toggle).not.toHaveAttribute("data-pressed");
    }
  },
};
