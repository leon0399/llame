import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "./field.js";
import { contrastKnownIssue232 } from "./known-a11y-issues.js";
import { Label } from "./label.js";
import { Switch } from "./switch.js";

// Every non-RTL example on the shadcn Switch docs
// (https://ui.shadcn.com/docs/components/radix/switch) is transcribed
// verbatim below, so the file carries the "shadcn-example" provenance tag at
// the meta level. Compatibility is about usage, not which registry an
// example file lives in (packages/ui/AGENTS.md): every example here composes
// the standard Radix Switch API plus `Field`/`FieldLabel`/`FieldContent`/
// `FieldDescription`/`FieldGroup`/`FieldTitle`, all of which our switch.tsx
// and field.tsx fully export — so a prior sweep's conclusion that the
// Description/Choice Card/Disabled/Invalid/Size examples were "nova-only /
// broken" was wrong (it checked the wrong, largely-404
// `registry/new-york-v4/examples/` path and mistook the `bases/radix`
// *component reimplementation* for the examples themselves). The correct
// source is `apps/v4/examples/radix/switch-<x>.tsx` on GitHub main, the files
// the docs' "Radix UI" tab renders — no API gap exists for any of them. RTL
// is skipped by convention. `WithAriaLabel`, `DefaultChecked`, and
// `DisabledChecked` remain our own additional states (no upstream example)
// and stay tagged "ai-generated".
const meta = {
  component: Switch,
  parameters: {
    layout: "centered",
  },
  // The Field-based examples (Description, Choice Card, Invalid, Sizes) need a
  // defined width or their text column collapses to one word per line under
  // the centered layout. Give the file one fixed frame and strip the per-story
  // widths so every example renders uniformly.
  decorators: [
    (Story) => (
      <div className="w-[24rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "default"],
      description: "Visual size of the switch and its thumb.",
    },
    defaultChecked: {
      control: "boolean",
      description: "Whether the switch is checked by default",
    },
    checked: {
      control: "boolean",
      description: "Whether the switch is checked",
    },
    onCheckedChange: {
      control: false,
      description: "Callback fired when the checked state changes",
      type: { name: "function", required: false },
    },
    disabled: {
      control: "boolean",
      description: "Whether the switch is disabled",
    },
  },
} satisfies Meta<typeof Switch>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The standard way to pair a switch with a visible label — `Label`'s
 * `htmlFor` means clicking the label text also toggles the switch.
 *
 * Verbatim from [shadcn Switch demo](https://ui.shadcn.com/docs/components/radix/switch).
 *
 * @summary for the default labelled form switch
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {},
  render: (args) => (
    <div className="flex items-center space-x-2">
      <Switch id="airplane-mode" {...args} />
      <Label htmlFor="airplane-mode">Airplane Mode</Label>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const switchElement = canvas.getByRole("switch");
    const label = canvas.getByText("Airplane Mode");

    await expect(switchElement).toBeInTheDocument();
    await expect(label).toBeInTheDocument();
    await expect(switchElement).not.toBeChecked();

    await userEvent.click(switchElement);
    await expect(switchElement).toBeChecked();

    await userEvent.click(label);
    await expect(switchElement).not.toBeChecked();
  },
};

/**
 * Pair a switch with a `FieldDescription` when the setting's effect isn't
 * obvious from the label alone — `Field`'s horizontal orientation keeps the
 * switch aligned to the label's first line.
 *
 * Verbatim from [shadcn Switch › Description](https://ui.shadcn.com/docs/components/radix/switch#description).
 *
 * @summary for a labelled switch with explanatory description text
 */
export const Description: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor="switch-focus-mode">
          Share across devices
        </FieldLabel>
        <FieldDescription>
          Focus is shared across devices, and turns off when you leave the app.
        </FieldDescription>
      </FieldContent>
      <Switch id="switch-focus-mode" />
    </Field>
  ),
  play: async ({ canvas, userEvent }) => {
    const switchElement = canvas.getByRole("switch", {
      name: /share across devices/i,
    });
    const description = canvas.getByText(/focus is shared across devices/i);

    await expect(switchElement).toBeInTheDocument();
    await expect(description).toBeInTheDocument();
    await expect(switchElement).not.toBeChecked();

    await userEvent.click(switchElement);
    await expect(switchElement).toBeChecked();
  },
};

/**
 * Wrap each `Field` in a `FieldLabel` to turn the whole row into a clickable
 * "choice card" — a labelled switch with a title and description where tapping
 * anywhere toggles it. Use for a short list of related on/off settings.
 *
 * Verbatim from [shadcn Switch › Choice Card](https://ui.shadcn.com/docs/components/radix/switch#choice-card).
 *
 * @summary for a stack of clickable switch choice-cards
 */
export const ChoiceCard: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // #232: FieldDescription (text-muted-foreground) on the muted choice-card
  // surface fails color-contrast at 4.27:1 — real token defect, suppress only
  // that rule.
  parameters: contrastKnownIssue232,
  render: () => (
    <FieldGroup>
      <FieldLabel htmlFor="switch-share">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>Share across devices</FieldTitle>
            <FieldDescription>
              Focus is shared across devices, and turns off when you leave the
              app.
            </FieldDescription>
          </FieldContent>
          <Switch id="switch-share" aria-label="Share across devices" />
        </Field>
      </FieldLabel>
      <FieldLabel htmlFor="switch-notifications">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>Enable notifications</FieldTitle>
            <FieldDescription>
              Receive notifications when focus mode is enabled or disabled.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="switch-notifications"
            aria-label="Enable notifications"
            defaultChecked
          />
        </Field>
      </FieldLabel>
    </FieldGroup>
  ),
};

/**
 * Add `disabled` to the switch (and `data-disabled` to the wrapping `Field`
 * for styling) for a temporarily unavailable setting.
 *
 * Verbatim from [shadcn Switch › Disabled](https://ui.shadcn.com/docs/components/radix/switch#disabled).
 *
 * @summary for a non-interactive disabled switch with visible label
 */
export const Disabled: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Field orientation="horizontal" data-disabled>
      <Switch id="switch-disabled-unchecked" disabled />
      <FieldLabel htmlFor="switch-disabled-unchecked">Disabled</FieldLabel>
    </Field>
  ),
  play: async ({ canvas, userEvent }) => {
    const switchElement = canvas.getByRole("switch");

    await expect(switchElement).not.toBeChecked();
    await userEvent.click(switchElement);
    await expect(switchElement).not.toBeChecked();
  },
};

/**
 * Add `aria-invalid` to the switch (and `data-invalid` to the wrapping
 * `Field` for styling) to flag a required setting that hasn't been accepted.
 *
 * Verbatim from [shadcn Switch › Invalid](https://ui.shadcn.com/docs/components/radix/switch#invalid).
 *
 * @summary for an invalid/required switch state
 */
export const Invalid: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Field orientation="horizontal" data-invalid>
      <FieldContent>
        <FieldLabel htmlFor="switch-terms">
          Accept terms and conditions
        </FieldLabel>
        <FieldDescription>
          You must accept the terms and conditions to continue.
        </FieldDescription>
      </FieldContent>
      <Switch id="switch-terms" aria-invalid />
    </Field>
  ),
  play: async ({ canvas }) => {
    const switchElement = canvas.getByRole("switch");

    await expect(switchElement).toHaveAttribute("aria-invalid", "true");
    await expect(switchElement).not.toBeChecked();
  },
};

/**
 * Use a bare switch only when the surrounding context labels it; an
 * `aria-label` is required without a visible Label.
 *
 * @summary for a bare switch with aria-label only
 */
export const WithAriaLabel: Story = {
  tags: ["ai-generated"],
  args: {
    "aria-label": "Bare switch",
  },
  play: async ({ canvas, userEvent }) => {
    const switchElement = canvas.getByRole("switch");

    await expect(switchElement).not.toBeChecked();
    await userEvent.click(switchElement);
    await expect(switchElement).toBeChecked();
  },
};

/**
 * Use `defaultChecked` for uncontrolled switches that start on; the play
 * function verifies it still toggles freely.
 *
 * @summary for uncontrolled initially-on state
 */
export const DefaultChecked: Story = {
  tags: ["ai-generated"],
  args: {
    "aria-label": "Default checked switch",
    defaultChecked: true,
  },
  play: async ({ canvas, userEvent }) => {
    const switchElement = canvas.getByRole("switch");

    await expect(switchElement).toBeChecked();
    await userEvent.click(switchElement);
    await expect(switchElement).not.toBeChecked();
    await userEvent.click(switchElement);
    await expect(switchElement).toBeChecked();
  },
};

/**
 * Use `disabled` + `checked` for a locked-on setting (e.g. enforced by
 * policy); the play function verifies it cannot be turned off.
 *
 * @summary for locked-on state
 */
export const DisabledChecked: Story = {
  tags: ["ai-generated"],
  args: {
    "aria-label": "Disabled checked switch",
    checked: true,
    disabled: true,
  },
  play: async ({ canvas, userEvent }) => {
    const switchElement = canvas.getByRole("switch");

    await expect(switchElement).toBeChecked();
    await userEvent.click(switchElement);
    await expect(switchElement).toBeChecked();
  },
};

/**
 * Use the `size` prop to fit the switch to denser layouts (`sm`) or the
 * standard form density (`default`).
 *
 * Verbatim from [shadcn Switch › Size](https://ui.shadcn.com/docs/components/radix/switch#size).
 *
 * @summary reference of the switch size scale
 */
export const Sizes: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <FieldGroup>
      <Field orientation="horizontal">
        <Switch id="switch-size-sm" size="sm" />
        <FieldLabel htmlFor="switch-size-sm">Small</FieldLabel>
      </Field>
      <Field orientation="horizontal">
        <Switch id="switch-size-default" size="default" />
        <FieldLabel htmlFor="switch-size-default">Default</FieldLabel>
      </Field>
    </FieldGroup>
  ),
  play: async ({ canvas }) => {
    const switches = canvas.getAllByRole("switch");

    await expect(switches).toHaveLength(2);
    await expect(switches[0]).toHaveAttribute("data-size", "sm");
    await expect(switches[1]).toHaveAttribute("data-size", "default");
  },
};
