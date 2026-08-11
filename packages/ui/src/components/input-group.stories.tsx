import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  BracesIcon,
  CheckIcon,
  CopyIcon,
  CornerDownLeftIcon,
  CreditCardIcon,
  InfoIcon,
  MailIcon,
  RefreshCwIcon,
  SearchIcon,
  StarIcon,
  XIcon,
} from "lucide-react";
import { expect, userEvent } from "storybook/test";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "./input-group.js";

// The transcribed stories below come from the shadcn Input Group docs
// examples (https://ui.shadcn.com/docs/components/base/input-group) and carry
// the "shadcn-example" tag; `Search` is ours and carries only "ai-generated".
//
// This is a FOCUSED story set, not the full upstream sweep — logged here
// rather than left silent. Covered: `input-group-demo` (Basic),
// `input-group-icon` (WithIcon), `input-group-text` (WithText),
// `input-group-textarea` (WithTextarea). Skipped:
// - `input-group-button` — imports `useCopyToClipboard` from the docs app's
//   own hooks (a companion we don't vendor) and a Radix `PopoverTrigger
//   asChild`, which our base-ui Popover expresses as `render`. The trailing-
//   button concept is covered by our own `Search` story instead.
// - `input-group-inline-start` / `-inline-end` / `-block-start` / `-block-end`
//   — the four `align` values; `WithIcon` and `WithTextarea` already render
//   three of them (inline-start, inline-end, block-start/end).
// - `input-group-kbd`, `-dropdown`, `-spinner`, `-custom` — addon-content
//   variations that exercise companion components, not this component's API.
// - `input-group-rtl` — RTL, skipped by convention.
//
// A11y adaptations beyond import/icon paths: upstream leaves several inputs
// and icon-only buttons without an accessible name (placeholder alone is not
// one), which our stricter gate rejects — `aria-label`s are added on
// `WithIcon`, `WithText`, and `WithTextarea`. Per-example width classes
// (`max-w-xs`, `max-w-sm`, `max-w-md`, `w-full`) are stripped in favour of the
// meta decorator's single frame, per packages/ui/CLAUDE.md.
const meta = {
  component: InputGroup,
  subcomponents: {
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
    InputGroupText,
    InputGroupTextarea,
  },
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="w-[24rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof InputGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use the group whenever a field needs adornments: the border and focus ring
 * belong to the group, so a leading icon and a trailing hint read as one
 * control instead of decoration stuck beside an input.
 *
 * Verbatim from [shadcn Input Group demo](https://ui.shadcn.com/docs/components/base/input-group)
 * (the default example at the top of the page, before any heading).
 *
 * @summary for the standard field with a leading icon and a trailing hint
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <InputGroup>
      <InputGroupInput placeholder="Search..." aria-label="Search" />
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupAddon align="inline-end">12 results</InputGroupAddon>
    </InputGroup>
  ),
};

/**
 * Use an icon addon to name the field's purpose at a glance — and either side,
 * or both, when the trailing icon carries status (here, a validated card).
 *
 * Verbatim from [shadcn Input Group / Icon](https://ui.shadcn.com/docs/components/base/input-group#icon).
 *
 * @summary for icon adornments on either side of the control
 */
export const WithIcon: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <div className="grid gap-6">
      <InputGroup>
        <InputGroupInput placeholder="Search..." aria-label="Search" />
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupInput
          type="email"
          placeholder="Enter your email"
          aria-label="Email"
        />
        <InputGroupAddon>
          <MailIcon />
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupInput placeholder="Card number" aria-label="Card number" />
        <InputGroupAddon>
          <CreditCardIcon />
        </InputGroupAddon>
        <InputGroupAddon align="inline-end">
          <CheckIcon />
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupInput placeholder="Card number" aria-label="Saved card" />
        <InputGroupAddon align="inline-end">
          <StarIcon />
          <InfoIcon />
        </InputGroupAddon>
      </InputGroup>
    </div>
  ),
};

/**
 * Use text addons for units and fixed affixes — a currency, a scheme, a mail
 * domain — so the user never types the part that is already known.
 *
 * Verbatim from [shadcn Input Group / Text](https://ui.shadcn.com/docs/components/base/input-group#text).
 *
 * @summary for unit and affix text attached to the control
 */
export const WithText: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <div className="grid gap-6">
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>$</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput placeholder="0.00" aria-label="Amount in USD" />
        <InputGroupAddon align="inline-end">
          <InputGroupText>USD</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>https://</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          placeholder="example.com"
          className="pl-0.5!"
          aria-label="Domain"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>.com</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupInput
          placeholder="Enter your username"
          aria-label="Username"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>@company.com</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupTextarea
          placeholder="Enter your message"
          aria-label="Message"
        />
        <InputGroupAddon align="block-end">
          <InputGroupText className="text-xs text-muted-foreground">
            120 characters left
          </InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </div>
  ),
};

/**
 * Use `block-start`/`block-end` addons to turn the group into a small editor
 * pane: the toolbar and status row belong to the field rather than floating
 * beside it.
 *
 * Verbatim from [shadcn Input Group / Textarea](https://ui.shadcn.com/docs/components/base/input-group#textarea).
 *
 * @summary for a multi-line control with toolbar and status rows
 */
export const WithTextarea: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <div className="grid gap-4">
      <InputGroup>
        <InputGroupTextarea
          id="textarea-code-32"
          placeholder="console.log('Hello, world!');"
          aria-label="Script source"
          className="min-h-[200px]"
        />
        <InputGroupAddon align="block-end" className="border-t">
          <InputGroupText>Line 1, Column 1</InputGroupText>
          <InputGroupButton size="sm" className="ml-auto" variant="default">
            Run <CornerDownLeftIcon />
          </InputGroupButton>
        </InputGroupAddon>
        <InputGroupAddon align="block-start" className="border-b">
          <InputGroupText className="font-mono font-medium">
            <BracesIcon />
            script.js
          </InputGroupText>
          <InputGroupButton
            className="ml-auto"
            size="icon-xs"
            aria-label="Reload"
          >
            <RefreshCwIcon />
          </InputGroupButton>
          <InputGroupButton variant="ghost" size="icon-xs" aria-label="Copy">
            <CopyIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  ),
};

/**
 * The shape llame's own filter fields use (`SearchFilterInput`): a magnifier
 * addon, and a clear button that only exists while there is something to
 * clear. The play function types, clears, and asserts the button is gone
 * again.
 *
 * @summary for a search/filter field with a conditional clear button
 */
export const Search: Story = {
  tags: ["ai-generated"],
  render: function SearchRender() {
    const [value, setValue] = React.useState("");

    return (
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Search projects…"
          aria-label="Search projects"
        />
        {value !== "" && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" onClick={() => setValue("")}>
              <XIcon />
              <span className="sr-only">Clear search</span>
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
    );
  },
  play: async ({ canvas }) => {
    const field = canvas.getByRole("textbox", { name: "Search projects" });
    await userEvent.type(field, "res");
    await expect(field).toHaveValue("res");

    await userEvent.click(canvas.getByRole("button", { name: "Clear search" }));
    await expect(field).toHaveValue("");
    await expect(
      canvas.queryByRole("button", { name: "Clear search" }),
    ).toBeNull();
  },
};
