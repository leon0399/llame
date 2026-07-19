import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { Field, FieldDescription, FieldLabel } from "./field.js";
import { Input } from "./input.js";

// Every story in this file is transcribed verbatim from the shadcn Input
// docs examples (https://ui.shadcn.com/docs/components/radix/input), so the
// file carries the "shadcn-example" provenance tag at the meta level. RTL is
// skipped by convention, as are `input-input-group`/`input-button-group`
// (InputGroup/ButtonGroup, companion components we don't vendor). Two
// additional non-RTL, non-InputGroup examples were fetched but deliberately
// not turned into their own stories:
// - `input-basic` (bare `<Input placeholder="Enter text" />`, no Field) is
//   redundant with `Basic` below, which already covers the top-of-page
//   `input-demo` example per the same precedent as select/textarea's `Basic`.
// - `input-form` composes Input + Select + Button + FieldGroup into one
//   multi-field form. It does NOT import react-hook-form's `useForm`/`Form`
//   (contrary to the brief's assumption), so the literal RHF-skip condition
//   doesn't apply — but it crosses multiple concepts in one story (a
//   stories.md anti-pattern) and isn't part of the planned story set, so it's
//   logged here as skipped rather than added.
// NOTE (verified against fetched upstream source, not the assigning brief):
// `input-invalid` and `input-required` compose `Field`/`FieldLabel`/
// `FieldDescription`, not `FieldError` — transcribed as-is.
const meta = {
  component: Input,
  parameters: {
    layout: "centered",
  },
  // Mirror the docs' ComponentPreview frame: input is an inline form
  // control, so center each example and width-constrain it to a single
  // width (matching upstream's own `max-w-xs` preview sizing), instead of
  // each story picking its own size.
  decorators: [
    (Story) => (
      <div className="w-[24rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs", "shadcn-example"],
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use `Field`, `FieldLabel`, and `FieldDescription` to pair the input with a
 * label and helper text — the standard shape for a single labelled field.
 *
 * Verbatim from [shadcn Input demo](https://ui.shadcn.com/docs/components/radix/input)
 * (the default example at the top of the page, before any heading).
 *
 * @summary for the standard labelled text input
 */
export const Basic: Story = {
  render: () => (
    <Field>
      <FieldLabel htmlFor="input-demo-api-key">API Key</FieldLabel>
      <Input id="input-demo-api-key" type="password" placeholder="sk-..." />
      <FieldDescription>
        Your API key is encrypted and stored securely.
      </FieldDescription>
    </Field>
  ),
};

/**
 * Use the `disabled` prop to disable the input, and `data-disabled` on the
 * `Field` to style the surrounding label and description as disabled too.
 *
 * Verbatim from [shadcn Input › Disabled](https://ui.shadcn.com/docs/components/radix/input#disabled).
 *
 * @summary for a disabled input field
 */
export const Disabled: Story = {
  render: () => (
    <Field data-disabled>
      <FieldLabel htmlFor="input-demo-disabled">Email</FieldLabel>
      <Input
        id="input-demo-disabled"
        type="email"
        placeholder="Email"
        disabled
      />
      <FieldDescription>This field is currently disabled.</FieldDescription>
    </Field>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByPlaceholderText("Email")).toBeDisabled();
  },
};

/**
 * Use `type="file"` to create a file input.
 *
 * Verbatim from [shadcn Input › File](https://ui.shadcn.com/docs/components/radix/input#file).
 *
 * @summary for a file upload input
 */
export const File: Story = {
  render: () => (
    <Field>
      <FieldLabel htmlFor="picture">Picture</FieldLabel>
      <Input id="picture" type="file" />
      <FieldDescription>Select a picture to upload.</FieldDescription>
    </Field>
  ),
};

/**
 * Use `aria-invalid` to mark the input as invalid, and `data-invalid` on the
 * `Field` to style the surrounding label and description.
 *
 * Verbatim from [shadcn Input › Invalid](https://ui.shadcn.com/docs/components/radix/input#invalid).
 *
 * @summary for a validation error state
 */
export const Invalid: Story = {
  render: () => (
    <Field data-invalid>
      <FieldLabel htmlFor="input-invalid">Invalid Input</FieldLabel>
      <Input id="input-invalid" placeholder="Error" aria-invalid />
      <FieldDescription>
        This field contains validation errors.
      </FieldDescription>
    </Field>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByPlaceholderText("Error")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  },
};

/**
 * Use the `required` attribute to indicate required inputs.
 *
 * Verbatim from [shadcn Input › Required](https://ui.shadcn.com/docs/components/radix/input#required).
 *
 * @summary for a required input field
 */
export const Required: Story = {
  render: () => (
    <Field>
      <FieldLabel htmlFor="input-required">
        Required Field <span className="text-destructive">*</span>
      </FieldLabel>
      <Input
        id="input-required"
        placeholder="This field is required"
        required
      />
      <FieldDescription>This field must be filled out.</FieldDescription>
    </Field>
  ),
};

/**
 * Use `Field`, `FieldLabel`, and `FieldDescription` to create an input with a
 * label and description.
 *
 * Verbatim from [shadcn Input › Field](https://ui.shadcn.com/docs/components/radix/input#field).
 *
 * @summary for a labelled input with helper text
 */
export const WithField: Story = {
  render: () => (
    <Field>
      <FieldLabel htmlFor="input-field-username">Username</FieldLabel>
      <Input
        id="input-field-username"
        type="text"
        placeholder="Enter your username"
      />
      <FieldDescription>
        Choose a unique username for your account.
      </FieldDescription>
    </Field>
  ),
};
