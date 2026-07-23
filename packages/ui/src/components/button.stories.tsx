import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  CircleFadingArrowUpIcon,
  GitBranchIcon,
} from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";

import { Button, buttonVariants } from "./button.js";
import { contrastKnownIssue232 } from "./known-a11y-issues.js";

// Every story here is transcribed from the shadcn Button docs examples
// (https://ui.shadcn.com/docs/components/base/button), so the file carries the
// "shadcn-example" provenance tag on each transcribed story. Adaptations are limited to
// our lucide icon set, framework primitives, and accessible names our a11y gate
// requires; each story links its docs anchor. Upstream examples we intentionally
// skip: Spinner and Button Group (companion components we have not vendored) and
// RTL (excluded by convention).
const meta = {
  component: Button,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "destructive",
        "outline",
        "secondary",
        "ghost",
        "link",
      ],
      description: "Visual emphasis / semantic style of the button.",
    },
    size: {
      control: "select",
      options: [
        "default",
        "xs",
        "sm",
        "lg",
        "icon",
        "icon-xs",
        "icon-sm",
        "icon-lg",
      ],
      description:
        "Height and padding; the `icon*` sizes are square for icon-only buttons.",
    },
  },
  args: {
    onClick: fn(),
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The default button, for the primary action in a view.
 *
 * Verbatim from [shadcn Button › Default](https://ui.shadcn.com/docs/components/base/button#default).
 *
 * @summary for the default primary action
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    children: "Button",
  },
  play: async ({ args, canvas, userEvent }) => {
    const button = canvas.getByRole("button", { name: "Button" });

    await expect(button).toBeInTheDocument();
    await userEvent.click(button);
    expect(args.onClick).toHaveBeenCalledOnce();
  },
};

/**
 * Medium-emphasis action that stands on its own without a filled background.
 *
 * Verbatim from [shadcn Button › Outline](https://ui.shadcn.com/docs/components/base/button#outline).
 *
 * @summary for a medium-emphasis bordered action
 */
export const Outline: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    variant: "outline",
    children: "Outline",
  },
};

/**
 * Lower-emphasis alternative to the default, for supporting actions beside a
 * primary button.
 *
 * Verbatim from [shadcn Button › Secondary](https://ui.shadcn.com/docs/components/base/button#secondary).
 *
 * @summary for lower-emphasis supporting actions
 */
export const Secondary: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    variant: "secondary",
    children: "Secondary",
  },
};

/**
 * Minimal, background-less action for low-emphasis or dense contexts such as
 * toolbars.
 *
 * Verbatim from [shadcn Button › Ghost](https://ui.shadcn.com/docs/components/base/button#ghost).
 *
 * @summary for low-emphasis inline/toolbar actions
 */
export const Ghost: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    variant: "ghost",
    children: "Ghost",
  },
};

/**
 * Signals a dangerous or irreversible action such as delete.
 *
 * Verbatim from [shadcn Button › Destructive](https://ui.shadcn.com/docs/components/base/button#destructive).
 *
 * @summary for dangerous or irreversible actions
 */
export const Destructive: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // #232 — base-nova's subtle destructive (`bg-destructive/10 text-destructive`)
  // falls below WCAG AA color-contrast (our pre-migration solid red passed).
  // Suppress the color-contrast rule until the #232 token fix; flagged for review.
  parameters: contrastKnownIssue232,
  args: {
    variant: "destructive",
    children: "Destructive",
  },
};

/**
 * Renders as inline text with a hover underline, for navigation styled as a
 * link rather than a button surface.
 *
 * Verbatim from [shadcn Button › Link](https://ui.shadcn.com/docs/components/base/button#link).
 *
 * @summary for navigation styled as an inline link
 */
export const Link: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    variant: "link",
    children: "Link",
  },
};

/**
 * Icon-only action for toolbars and tight layouts. Upstream's example omits an
 * accessible name; we add `aria-label` to satisfy the a11y gate (matching
 * shadcn's own icon buttons in the Size example).
 *
 * Adapted from [shadcn Button › Icon](https://ui.shadcn.com/docs/components/base/button#icon).
 *
 * @summary for icon-only actions (requires an accessible name)
 */
export const Icon: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    variant: "outline",
    size: "icon",
    "aria-label": "Submit",
    children: <CircleFadingArrowUpIcon />,
  },
};

/**
 * Leading icon reinforcing the action; the button spaces the icon itself.
 * Adapted for our `lucide` icon set (upstream uses `@tabler/icons-react`).
 *
 * Adapted from [shadcn Button › With Icon](https://ui.shadcn.com/docs/components/base/button#with-icon).
 *
 * @summary for a text button with a leading icon
 */
export const WithIcon: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    variant: "outline",
    size: "sm",
    children: (
      <>
        <GitBranchIcon /> New Branch
      </>
    ),
  },
};

/**
 * The size scale — `sm`, default, and `lg`, each with its icon-only counterpart.
 * Our component also provides `xs` / `icon-xs` (see the `size` control). Args are
 * spread into every button, so the `variant` control and click actions drive the
 * whole showcase while each button keeps its own fixed `size`.
 *
 * Adapted from [shadcn Button › Size](https://ui.shadcn.com/docs/components/base/button#size).
 *
 * @summary reference of the button size scale
 */
export const Sizes: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    variant: "outline",
  },
  // `size` is fixed per button in this showcase, so its control would be inert
  // here — disable it (the row stays visible, just not editable).
  argTypes: {
    size: { control: false },
  },
  render: (args) => (
    <div className="flex flex-col items-start gap-8 sm:flex-row">
      <div className="flex items-start gap-2">
        <Button {...args} size="sm">
          Small
        </Button>
        <Button {...args} size="icon-sm" aria-label="Submit">
          <ArrowUpRightIcon />
        </Button>
      </div>
      <div className="flex items-start gap-2">
        <Button {...args} size="default">
          Default
        </Button>
        <Button {...args} size="icon" aria-label="Submit">
          <ArrowUpRightIcon />
        </Button>
      </div>
      <div className="flex items-start gap-2">
        <Button {...args} size="lg">
          Large
        </Button>
        <Button {...args} size="icon-lg" aria-label="Submit">
          <ArrowUpRightIcon />
        </Button>
      </div>
    </div>
  ),
};

/**
 * A fully rounded (circular) button via the `rounded-full` utility class. We add
 * `aria-label` for the icon-only button to satisfy the a11y gate.
 *
 * Adapted from [shadcn Button › Rounded](https://ui.shadcn.com/docs/components/base/button#rounded).
 *
 * @summary for a fully rounded button via rounded-full
 */
export const Rounded: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    variant: "outline",
    size: "icon",
    className: "rounded-full",
    "aria-label": "Submit",
    children: <ArrowUpIcon />,
  },
};

/**
 * A link that looks like a button: apply `buttonVariants()` to a native `<a>`
 * rather than `render={<a/>}`. The Base UI Button always sets `role="button"`,
 * which would strip the anchor's link semantics, so the docs use the class
 * helper on a real anchor instead.
 *
 * Transcribed from [shadcn Button › As Link](https://ui.shadcn.com/docs/components/base/button#as-link).
 *
 * @summary for a link styled as a button, via `buttonVariants`
 */
export const AsLink: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <a
      href="#"
      className={buttonVariants({ variant: "secondary", size: "sm" })}
    >
      Login
    </a>
  ),
};
