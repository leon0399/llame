import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "./button.js";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "./field.js";
import { Input } from "./input.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select.js";
import { Switch } from "./switch.js";
import { Textarea } from "./textarea.js";

// Every story in this file is transcribed verbatim from the shadcn Field
// docs examples (https://ui.shadcn.com/docs/components/base/field), so the
// file carries the "shadcn-example" provenance tag on each transcribed story.
//
// Skipped (unvendored companion dependency, a genuine API gap — not a
// stylistic choice): `field-demo` (the page's own lead/unanchored preview —
// composes `Checkbox`, which we don't vendor, for its "Same as shipping
// address" row), `field-group` (also composes `Checkbox`), `field-checkbox`
// (`Checkbox`), `field-radio` (`RadioGroup`), `field-slider` (`Slider`), and
// `field-choice-card` (`RadioGroup` — this is a real compatibility gap, not
// the shared muted-foreground/destructive contrast defect #232 its section
// heading might suggest; `RadioGroup` is simply not in
// `packages/ui/src/components`). `field-rtl` is skipped by convention.
//
// With `field-demo` unusable, `Basic` below is promoted from `field-input`
// (the next-simplest example: a `FieldSet` of two `Field`s) rather than the
// page's own top preview — there is no remaining unanchored example to use
// instead, so `Basic` links its own `#input` anchor.
const meta = {
  component: Field,
  subcomponents: {
    FieldContent,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSet,
  },
  parameters: {
    layout: "centered",
  },
  // Field is an inline form primitive; mirror the docs' single centered
  // preview frame so the verbatim per-example widths (a mix of `max-w-xs`,
  // `max-w-sm`, `max-w-lg`, `w-fit`) render uniformly here instead of each
  // story picking its own size.
  decorators: [
    (Story) => (
      <div className="w-[24rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof Field>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use a `FieldSet` of `Field`s for a group of text inputs, each with a
 * `FieldLabel` and a `FieldDescription` — the description can sit either
 * after the control (Username) or before it (Password).
 *
 * Adapted from [shadcn Field › Input](https://ui.shadcn.com/docs/components/base/field#input).
 *
 * @summary for a group of labelled text inputs with helper text
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <FieldSet className="w-full">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="username">Username</FieldLabel>
          <Input id="username" type="text" placeholder="Max Leiter" />
          <FieldDescription>
            Choose a unique username for your account.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <FieldDescription>
            Must be at least 8 characters long.
          </FieldDescription>
          <Input id="password" type="password" placeholder="••••••••" />
        </Field>
      </FieldGroup>
    </FieldSet>
  ),
};

/**
 * Use a `Field` with a `Textarea` for freeform multi-line input, paired with
 * a `FieldLabel` and `FieldDescription`.
 *
 * Adapted from [shadcn Field › Textarea](https://ui.shadcn.com/docs/components/base/field#textarea).
 *
 * @summary for a labelled multi-line text field
 */
export const WithTextarea: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <FieldSet className="w-full">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="feedback">Feedback</FieldLabel>
          <Textarea
            id="feedback"
            placeholder="Your feedback helps us improve..."
            rows={4}
          />
          <FieldDescription>
            Share your thoughts about our service.
          </FieldDescription>
        </Field>
      </FieldGroup>
    </FieldSet>
  ),
};

/**
 * Use a `Field` with a `Select` for a single choice from a labelled list,
 * paired with a `FieldLabel` and `FieldDescription`.
 *
 * Adapted from [shadcn Field › Select](https://ui.shadcn.com/docs/components/base/field#select).
 * Upstream's `FieldLabel` isn't wired to the trigger (no `htmlFor`/`id`
 * pair); we add `aria-label` on the trigger to satisfy the a11y gate.
 *
 * @summary for a labelled single-choice select field
 */
export const WithSelect: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Field className="w-full">
      <FieldLabel>Department</FieldLabel>
      <Select>
        <SelectTrigger aria-label="Department">
          <SelectValue placeholder="Choose department" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="engineering">Engineering</SelectItem>
            <SelectItem value="design">Design</SelectItem>
            <SelectItem value="marketing">Marketing</SelectItem>
            <SelectItem value="sales">Sales</SelectItem>
            <SelectItem value="support">Customer Support</SelectItem>
            <SelectItem value="hr">Human Resources</SelectItem>
            <SelectItem value="finance">Finance</SelectItem>
            <SelectItem value="operations">Operations</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldDescription>
        Select your department or area of work.
      </FieldDescription>
    </Field>
  ),
};

/**
 * Use `orientation="horizontal"` to place a `FieldLabel` beside its control
 * — here a `Switch` — instead of stacking them.
 *
 * Adapted from [shadcn Field › Switch](https://ui.shadcn.com/docs/components/base/field#switch).
 *
 * @summary for a horizontal label-beside-control toggle field
 */
export const WithSwitch: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Field orientation="horizontal">
      <FieldLabel htmlFor="2fa">Multi-factor authentication</FieldLabel>
      <Switch id="2fa" />
    </Field>
  ),
};

/**
 * Use `FieldSet` with `FieldLegend` and `FieldDescription` to semantically
 * group related fields — here a two-column address form inside a
 * `FieldGroup`.
 *
 * Adapted from [shadcn Field › Fieldset](https://ui.shadcn.com/docs/components/base/field#fieldset).
 *
 * @summary for a semantically grouped set of fields
 */
export const Fieldset: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <FieldSet className="w-full">
      <FieldLegend>Address Information</FieldLegend>
      <FieldDescription>
        We need your address to deliver your order.
      </FieldDescription>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="street">Street Address</FieldLabel>
          <Input id="street" type="text" placeholder="123 Main St" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="city">City</FieldLabel>
            <Input id="city" type="text" placeholder="New York" />
          </Field>
          <Field>
            <FieldLabel htmlFor="zip">Postal Code</FieldLabel>
            <Input id="zip" type="text" placeholder="90502" />
          </Field>
        </div>
      </FieldGroup>
    </FieldSet>
  ),
};

/**
 * Use `orientation="responsive"` to stack label and control on narrow
 * viewports and align them side-by-side once the containing `FieldGroup`
 * crosses a container breakpoint — no separate mobile/desktop markup needed.
 *
 * Adapted from [shadcn Field › Responsive Layout](https://ui.shadcn.com/docs/components/base/field#responsive-layout).
 *
 * @summary for a field that switches orientation at a container breakpoint
 */
export const Responsive: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <div className="w-full">
      <form>
        <FieldSet>
          <FieldLegend>Profile</FieldLegend>
          <FieldDescription>Fill in your profile information.</FieldDescription>
          <FieldGroup>
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <FieldDescription>
                  Provide your full name for identification
                </FieldDescription>
              </FieldContent>
              <Input id="name" placeholder="Evil Rabbit" required />
            </Field>
            <Field orientation="responsive">
              <Button type="submit">Submit</Button>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Field>
          </FieldGroup>
        </FieldSet>
      </form>
    </div>
  ),
};
