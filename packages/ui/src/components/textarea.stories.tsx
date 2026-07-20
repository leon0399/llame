import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { Button } from "./button.js";
import { Field, FieldDescription, FieldLabel } from "./field.js";
import { Textarea } from "./textarea.js";

// Every story in this file is transcribed verbatim from the shadcn Textarea
// docs examples (https://ui.shadcn.com/docs/components/radix/textarea), so
// the file carries the "shadcn-example" provenance tag on each transcribed story.
// RTL is skipped by convention. `textarea-button` composes only `Button` +
// `Textarea` (no `InputGroup`, a companion component we don't vendor), so it
// is a straightforward transcription too — no API gap.
const meta = {
  component: Textarea,
  parameters: {
    layout: "centered",
  },
  // Mirror the docs' ComponentPreview frame: textarea is an inline form
  // control, so center each example and width-constrain it to a single
  // width (matching upstream's own `max-w-xs`-ish preview sizing), instead
  // of each story picking its own size.
  decorators: [
    (Story) => (
      <div className="w-[24rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof Textarea>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use for freeform multi-line text input, such as a message or comment box.
 *
 * Verbatim from [shadcn Textarea demo](https://ui.shadcn.com/docs/components/radix/textarea)
 * (the default example at the top of the page, before any heading).
 *
 * @summary for the standard multi-line text input
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => <Textarea placeholder="Type your message here." />,
};

/**
 * Use `Field`, `FieldLabel`, and `FieldDescription` to pair the textarea with
 * a label and helper text.
 *
 * Verbatim from [shadcn Textarea › Field](https://ui.shadcn.com/docs/components/radix/textarea#field).
 *
 * @summary for a labelled textarea with helper text
 */
export const WithField: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Field>
      <FieldLabel htmlFor="textarea-message">Message</FieldLabel>
      <FieldDescription>Enter your message below.</FieldDescription>
      <Textarea id="textarea-message" placeholder="Type your message here." />
    </Field>
  ),
};

/**
 * Use the `disabled` prop to disable the textarea, and `data-disabled` on the
 * `Field` to style the surrounding label as disabled too.
 *
 * Verbatim from [shadcn Textarea › Disabled](https://ui.shadcn.com/docs/components/radix/textarea#disabled).
 *
 * @summary for a disabled textarea
 */
export const Disabled: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Field data-disabled>
      <FieldLabel htmlFor="textarea-disabled">Message</FieldLabel>
      <Textarea
        id="textarea-disabled"
        placeholder="Type your message here."
        disabled
      />
    </Field>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByPlaceholderText("Type your message here."),
    ).toBeDisabled();
  },
};

/**
 * Use `aria-invalid` to mark the textarea as invalid, and `data-invalid` on
 * the `Field` to style the surrounding label and description.
 *
 * Verbatim from [shadcn Textarea › Invalid](https://ui.shadcn.com/docs/components/radix/textarea#invalid).
 *
 * @summary for a validation error state
 */
export const Invalid: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Field data-invalid>
      <FieldLabel htmlFor="textarea-invalid">Message</FieldLabel>
      <Textarea
        id="textarea-invalid"
        placeholder="Type your message here."
        aria-invalid
      />
      <FieldDescription>Please enter a valid message.</FieldDescription>
    </Field>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByPlaceholderText("Type your message here."),
    ).toHaveAttribute("aria-invalid", "true");
  },
};

/**
 * Pair with `Button` to create a textarea with a submit action below it.
 *
 * Verbatim from [shadcn Textarea › Button](https://ui.shadcn.com/docs/components/radix/textarea#button).
 *
 * @summary for a textarea with a submit button
 */
export const WithButton: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <div className="grid w-full gap-2">
      <Textarea placeholder="Type your message here." />
      <Button>Send message</Button>
    </div>
  ),
};
