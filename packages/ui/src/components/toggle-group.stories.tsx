import { useState } from "react";
import { Bold, Italic, Underline } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { Field, FieldDescription, FieldLabel } from "./field.js";
import { contrastKnownIssue232 } from "./known-a11y-issues.js";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group.js";

// Every story here is transcribed from the shadcn Toggle Group docs examples
// (https://ui.shadcn.com/docs/components/radix/toggle-group), so the file
// carries the "shadcn-example" provenance tag at the meta level. RTL is
// excluded by convention. The upstream "Custom" example is omitted pending the
// shared --muted-foreground contrast fix (#232) — see the NOTE below.
//
// ToggleGroup is a small inline row, like Kbd/Button — no width decorator,
// `layout: "centered"` alone matches the docs' preview frame.
const meta = {
  component: ToggleGroup,
  subcomponents: { ToggleGroupItem },
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs", "shadcn-example"],
  argTypes: {
    type: {
      // Radix types `type` as a discriminated union (single vs. multiple take
      // different value/defaultValue/onValueChange shapes), so each story
      // fixes it in `render` rather than via args, and the control is
      // disabled here.
      control: false,
      description:
        "Whether only one item can be pressed at a time (single) or several can be pressed together (multiple).",
    },
    variant: {
      control: "select",
      options: ["default", "outline"],
      description: "Visual style shared by the group and its items.",
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg"],
      description: "Height and padding shared by the group and its items.",
    },
  },
} satisfies Meta<typeof ToggleGroup>;

export default meta;

// Derive the story type from the component, not `typeof meta`: Radix's
// `ToggleGroup` props are a discriminated union (single vs. multiple), which
// `StoryObj<typeof meta>` collapses to a required `args: never`. Typing from
// the component keeps args as the optional union so `render`-only stories type.
type Story = StoryObj<typeof ToggleGroup>;

/**
 * Use `type="multiple"` for independent on/off toggles, such as a text
 * formatting toolbar where bold, italic, and underline can all be active at
 * once; the play function verifies each item toggles independently.
 *
 * Verbatim from the [shadcn Toggle Group demo](https://ui.shadcn.com/docs/components/radix/toggle-group).
 *
 * @summary for a multi-select formatting toolbar
 */
export const Basic: Story = {
  render: () => (
    <ToggleGroup variant="outline" type="multiple">
      <ToggleGroupItem value="bold" aria-label="Toggle bold">
        <Bold />
      </ToggleGroupItem>
      <ToggleGroupItem value="italic" aria-label="Toggle italic">
        <Italic />
      </ToggleGroupItem>
      <ToggleGroupItem value="strikethrough" aria-label="Toggle strikethrough">
        <Underline />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
  play: async ({ canvas, userEvent }) => {
    const bold = canvas.getByRole("button", { name: "Toggle bold" });
    const italic = canvas.getByRole("button", { name: "Toggle italic" });

    await expect(bold).toHaveAttribute("data-state", "off");
    await expect(bold).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(bold);
    await expect(bold).toHaveAttribute("data-state", "on");
    await expect(bold).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(italic);
    await expect(italic).toHaveAttribute("data-state", "on");
    // Bold stays pressed — items toggle independently under type="multiple".
    await expect(bold).toHaveAttribute("data-state", "on");

    await userEvent.click(bold);
    await expect(bold).toHaveAttribute("data-state", "off");
    await expect(italic).toHaveAttribute("data-state", "on");
  },
};

/**
 * Use `variant="outline"` with `type="single"` for a bordered filter/segment
 * control where exactly one option is active, such as a list filter.
 *
 * Verbatim from [shadcn Toggle Group › Outline](https://ui.shadcn.com/docs/components/radix/toggle-group#outline).
 *
 * @summary for a single-select bordered filter control
 */
export const Outline: Story = {
  render: () => (
    <ToggleGroup variant="outline" type="single" defaultValue="all">
      <ToggleGroupItem value="all" aria-label="Toggle all">
        All
      </ToggleGroupItem>
      <ToggleGroupItem value="missed" aria-label="Toggle missed">
        Missed
      </ToggleGroupItem>
    </ToggleGroup>
  ),
};

/**
 * The size scale — `sm` and default — for fitting a toggle group into denser
 * toolbars versus standard form controls.
 *
 * Verbatim from [shadcn Toggle Group › Size](https://ui.shadcn.com/docs/components/radix/toggle-group#size).
 *
 * @summary reference of the toggle group size scale
 */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <ToggleGroup type="single" size="sm" defaultValue="top" variant="outline">
        <ToggleGroupItem value="top" aria-label="Toggle top">
          Top
        </ToggleGroupItem>
        <ToggleGroupItem value="bottom" aria-label="Toggle bottom">
          Bottom
        </ToggleGroupItem>
        <ToggleGroupItem value="left" aria-label="Toggle left">
          Left
        </ToggleGroupItem>
        <ToggleGroupItem value="right" aria-label="Toggle right">
          Right
        </ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup type="single" defaultValue="top" variant="outline">
        <ToggleGroupItem value="top" aria-label="Toggle top">
          Top
        </ToggleGroupItem>
        <ToggleGroupItem value="bottom" aria-label="Toggle bottom">
          Bottom
        </ToggleGroupItem>
        <ToggleGroupItem value="left" aria-label="Toggle left">
          Left
        </ToggleGroupItem>
        <ToggleGroupItem value="right" aria-label="Toggle right">
          Right
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  ),
};

/**
 * Use `disabled` on the group to disable every item at once, e.g. while a
 * form section is read-only or a dependent field hasn't loaded yet.
 *
 * Verbatim from [shadcn Toggle Group › Disabled](https://ui.shadcn.com/docs/components/radix/toggle-group#disabled).
 *
 * @summary for disabling every item in the group at once
 */
export const Disabled: Story = {
  render: () => (
    <ToggleGroup disabled type="multiple">
      <ToggleGroupItem value="bold" aria-label="Toggle bold">
        <Bold />
      </ToggleGroupItem>
      <ToggleGroupItem value="italic" aria-label="Toggle italic">
        <Italic />
      </ToggleGroupItem>
      <ToggleGroupItem value="strikethrough" aria-label="Toggle strikethrough">
        <Underline />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
  play: async ({ canvas }) => {
    const bold = canvas.getByRole("button", { name: "Toggle bold" });
    await expect(bold).toBeDisabled();
  },
};

/**
 * Use `spacing` to separate items into distinct buttons instead of a single
 * connected segment, e.g. when each option should read as its own control.
 *
 * Verbatim from [shadcn Toggle Group › Spacing](https://ui.shadcn.com/docs/components/radix/toggle-group#spacing).
 *
 * @summary for a group of visually separated (unconnected) items
 */
export const Spacing: Story = {
  render: () => (
    <ToggleGroup
      type="single"
      size="sm"
      defaultValue="top"
      variant="outline"
      spacing={2}
    >
      <ToggleGroupItem value="top" aria-label="Toggle top">
        Top
      </ToggleGroupItem>
      <ToggleGroupItem value="bottom" aria-label="Toggle bottom">
        Bottom
      </ToggleGroupItem>
      <ToggleGroupItem value="left" aria-label="Toggle left">
        Left
      </ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="Toggle right">
        Right
      </ToggleGroupItem>
    </ToggleGroup>
  ),
};

/**
 * Use `orientation="vertical"` to stack items in a column, e.g. for a
 * sidebar toolbar or a narrow panel where a horizontal row would wrap.
 *
 * Verbatim from [shadcn Toggle Group › Vertical](https://ui.shadcn.com/docs/components/radix/toggle-group#vertical).
 *
 * @summary for a column-stacked toggle group
 */
export const Vertical: Story = {
  render: () => (
    <ToggleGroup
      type="multiple"
      orientation="vertical"
      spacing={1}
      defaultValue={["bold", "italic"]}
    >
      <ToggleGroupItem value="bold" aria-label="Toggle bold">
        <Bold />
      </ToggleGroupItem>
      <ToggleGroupItem value="italic" aria-label="Toggle italic">
        <Italic />
      </ToggleGroupItem>
      <ToggleGroupItem value="underline" aria-label="Toggle underline">
        <Underline />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
};

/**
 * Compose a `single` toggle group as a controlled visual picker inside a
 * `Field` — here a font-weight selector where each item previews its own
 * weight and the description reflects the current choice.
 *
 * Verbatim from [shadcn Toggle Group › Custom](https://ui.shadcn.com/docs/components/radix/toggle-group#custom).
 *
 * @summary for a controlled visual picker built from a toggle group
 */
export const Custom: Story = {
  // #232: the item sub-labels / FieldDescription (text-muted-foreground) on the
  // muted surface fail color-contrast — real token defect, suppress only that
  // rule.
  parameters: contrastKnownIssue232,
  render: function ToggleGroupFontWeightSelector() {
    const [fontWeight, setFontWeight] = useState("normal");
    return (
      <Field>
        <FieldLabel>Font Weight</FieldLabel>
        <ToggleGroup
          type="single"
          value={fontWeight}
          onValueChange={(value) => setFontWeight(value)}
          variant="outline"
          spacing={2}
          size="lg"
        >
          <ToggleGroupItem
            value="light"
            aria-label="Light"
            className="flex size-16 flex-col items-center justify-center rounded-xl"
          >
            <span className="text-2xl leading-none font-light">Aa</span>
            <span className="text-xs text-muted-foreground">Light</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="normal"
            aria-label="Normal"
            className="flex size-16 flex-col items-center justify-center rounded-xl"
          >
            <span className="text-2xl leading-none font-normal">Aa</span>
            <span className="text-xs text-muted-foreground">Normal</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="medium"
            aria-label="Medium"
            className="flex size-16 flex-col items-center justify-center rounded-xl"
          >
            <span className="text-2xl leading-none font-medium">Aa</span>
            <span className="text-xs text-muted-foreground">Medium</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="bold"
            aria-label="Bold"
            className="flex size-16 flex-col items-center justify-center rounded-xl"
          >
            <span className="text-2xl leading-none font-bold">Aa</span>
            <span className="text-xs text-muted-foreground">Bold</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>
          Use{" "}
          <code className="rounded-md bg-muted px-1 py-0.5 font-mono">
            font-{fontWeight}
          </code>{" "}
          to set the font weight.
        </FieldDescription>
      </Field>
    );
  },
};
