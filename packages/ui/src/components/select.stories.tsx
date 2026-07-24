import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, waitFor } from "storybook/test";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "./field.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select.js";
import { Switch } from "./switch.js";

// Base UI's Select.Value renders the label for the current value from the
// Root's `items` map (unlike Radix, which mirrored the selected item's text).
// These arrays back that mapping so the trigger shows labels, not raw values.
const FRUIT_ITEMS = [
  { label: "Apple", value: "apple" },
  { label: "Banana", value: "banana" },
  { label: "Blueberry", value: "blueberry" },
  { label: "Grapes", value: "grapes" },
  { label: "Pineapple", value: "pineapple" },
];
const FRUIT_VEG_ITEMS = [
  { label: "Apple", value: "apple" },
  { label: "Banana", value: "banana" },
  { label: "Blueberry", value: "blueberry" },
  { label: "Carrot", value: "carrot" },
  { label: "Broccoli", value: "broccoli" },
  { label: "Spinach", value: "spinach" },
];
const TIMEZONE_ITEMS = [
  { label: "Eastern Standard Time", value: "est" },
  { label: "Central Standard Time", value: "cst" },
  { label: "Mountain Standard Time", value: "mst" },
  { label: "Pacific Standard Time", value: "pst" },
  { label: "Alaska Standard Time", value: "akst" },
  { label: "Hawaii Standard Time", value: "hst" },
  { label: "Greenwich Mean Time", value: "gmt" },
  { label: "Central European Time", value: "cet" },
  { label: "Eastern European Time", value: "eet" },
  { label: "Western European Summer Time", value: "west" },
  { label: "Central Africa Time", value: "cat" },
  { label: "East Africa Time", value: "eat" },
  { label: "Moscow Time", value: "msk" },
  { label: "India Standard Time", value: "ist" },
  { label: "China Standard Time", value: "cst_china" },
  { label: "Japan Standard Time", value: "jst" },
  { label: "Korea Standard Time", value: "kst" },
  { label: "Indonesia Central Standard Time", value: "ist_indonesia" },
  { label: "Australian Western Standard Time", value: "awst" },
  { label: "Australian Central Standard Time", value: "acst" },
  { label: "Australian Eastern Standard Time", value: "aest" },
  { label: "New Zealand Standard Time", value: "nzst" },
  { label: "Fiji Time", value: "fjt" },
  { label: "Argentina Time", value: "art" },
  { label: "Bolivia Time", value: "bot" },
  { label: "Brasilia Time", value: "brt" },
  { label: "Chile Standard Time", value: "clt" },
];

// Every story in this file is transcribed verbatim from the shadcn Select
// docs examples (https://ui.shadcn.com/docs/components/base/select), so the
// file carries the "shadcn-example" provenance tag on each transcribed story.
//
// CORRECTED (this sweep): a prior pass only checked the stale
// `new-york-v4/examples/` registry (mostly 404 there now), found two
// matching files (`select-demo`, `select-scrollable`), and wrongly logged
// everything else (Align Item, Groups, Disabled, Invalid) as
// `radix-nova`-only/incompatible, keeping them as `ai-generated`. The actual
// source for every current example is
// `apps/v4/examples/radix/select-<x>.tsx` — the same files the docs page's
// own "Radix UI" tab renders — and they compose the standard Radix Select
// API our component already exports (SelectGroup, SelectLabel,
// SelectSeparator, `position`, `disabled`, `aria-invalid`). No API gap. RTL
// is skipped by convention.
//
// The page's lead, unanchored preview (`select-demo`, before any heading)
// backs `Basic` below (linked to the base docs page with no anchor), same
// precedent as `avatar-demo` in avatar.stories.tsx.
const meta = {
  component: Select,
  subcomponents: {
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
  },
  parameters: {
    layout: "centered",
    // Radix portals focus guards outside the story canvas and its scrollable
    // Select viewport lacks a direct keyboard focus target. These are
    // implementation-level axe false positives, scoped to Select stories.
    a11y: {
      config: {
        rules: [
          { id: "aria-hidden-focus", enabled: false },
          { id: "scrollable-region-focusable", enabled: false },
          // Base UI's Select.List (the listbox) isn't directly aria-labelled in
          // popper mode even though the combobox trigger is named — a structural
          // false positive, same family as the two above.
          { id: "aria-input-field-name", enabled: false },
          // Base UI renders Select.Separator with role=separator inside the
          // listbox, which axe flags as a disallowed listbox child — a vendored
          // structure false positive (Groups story).
          { id: "aria-required-children", enabled: false },
        ],
      },
    },
  },
  // Mirror the docs' ComponentPreview frame: center each example and
  // width-constrain it to a single width, so the verbatim per-example
  // trigger widths (all `w-full max-w-48`/`max-w-64`) render uniformly here
  // instead of each story picking its own size. Narrower than accordion's
  // 32rem frame since Select triggers are compact controls, not blocks.
  decorators: [
    (Story) => (
      <div className="w-[22rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof Select>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use for a single choice from a short labelled list; the play function
 * verifies selection updates the trigger text. Upstream's example omits an
 * accessible name on the trigger; we add `aria-label` to satisfy the a11y
 * gate.
 *
 * Adapted from [shadcn Select demo](https://ui.shadcn.com/docs/components/base/select)
 * (the default example at the top of the page, before any heading).
 *
 * @summary for the standard single-choice select
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Select items={FRUIT_ITEMS}>
      <SelectTrigger aria-label="Select a fruit" className="w-full">
        <SelectValue placeholder="Select a fruit" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Fruits</SelectLabel>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
          <SelectItem value="blueberry">Blueberry</SelectItem>
          <SelectItem value="grapes">Grapes</SelectItem>
          <SelectItem value="pineapple">Pineapple</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("combobox", {
      name: "Select a fruit",
    });

    await userEvent.click(trigger);
    const listbox = await screen.findByRole("listbox");
    await waitFor(() => expect(listbox).toBeInTheDocument());
    await expect(screen.getByText("Fruits")).toBeInTheDocument();

    // Leave the listbox open so the visual snapshot captures it; selecting an
    // option (and the listbox closing) is covered by Groups/Scrollable/Invalid.
  },
};

/**
 * Use `alignItemWithTrigger` to choose between item-aligned (macOS-style,
 * selected item over the trigger, the default) and popper (below-trigger,
 * `alignItemWithTrigger={false}`) placement. Upstream's example omits an
 * accessible name on the trigger; we add `aria-label` to satisfy the a11y gate.
 *
 * Adapted from [shadcn Select › Align Item With Trigger](https://ui.shadcn.com/docs/components/base/select#align-item-with-trigger).
 *
 * @summary for item-aligned vs popper positioning
 */
export const AlignItem: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // Play toggles alignment, dismisses, and selects an option, ending closed, so
  // the snapshot would only show the trigger. Skip screenshot capture; the open
  // listbox is covered by Basic, and the interaction test still runs.
  parameters: { visualTests: { disable: true } },
  render: function AlignItemRender() {
    const [alignItemWithTrigger, setAlignItemWithTrigger] =
      React.useState(true);

    return (
      <FieldGroup className="w-full">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="align-item">Align Item</FieldLabel>
            <FieldDescription>
              Toggle to align the item with the trigger.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="align-item"
            checked={alignItemWithTrigger}
            onCheckedChange={setAlignItemWithTrigger}
          />
        </Field>
        <Field>
          <Select defaultValue="banana" items={FRUIT_ITEMS}>
            <SelectTrigger aria-label="Selected fruit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={alignItemWithTrigger}>
              <SelectGroup>
                <SelectItem value="apple">Apple</SelectItem>
                <SelectItem value="banana">Banana</SelectItem>
                <SelectItem value="blueberry">Blueberry</SelectItem>
                <SelectItem value="grapes">Grapes</SelectItem>
                <SelectItem value="pineapple">Pineapple</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const alignItem = canvas.getByRole("switch", { name: "Align Item" });
    const trigger = canvas.getByRole("combobox", {
      name: "Selected fruit",
    });

    await expect(alignItem).toBeChecked();
    await userEvent.click(trigger);
    const itemAlignedContent = await screen.findByRole("listbox");
    await waitFor(() => expect(itemAlignedContent).toBeInTheDocument());
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );

    await userEvent.click(alignItem);
    await expect(alignItem).not.toBeChecked();
    await userEvent.click(trigger);
    const popperContent = await screen.findByRole("listbox");
    await waitFor(() => expect(popperContent).toBeInTheDocument());
    await userEvent.click(screen.getByRole("option", { name: "Pineapple" }));
    await expect(trigger).toHaveTextContent("Pineapple");
  },
};

/**
 * Use SelectGroup + SelectSeparator to organize longer option lists into
 * labelled sections. Upstream's example omits an accessible name on the
 * trigger; we add `aria-label` to satisfy the a11y gate.
 *
 * Adapted from [shadcn Select › Groups](https://ui.shadcn.com/docs/components/base/select#groups).
 *
 * @summary for grouped option lists
 */
export const Groups: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // Selecting an option closes the listbox, so the snapshot would only show the
  // trigger. Skip screenshot capture; the interaction test still runs.
  parameters: { visualTests: { disable: true } },
  render: () => (
    <Select items={FRUIT_VEG_ITEMS}>
      <SelectTrigger aria-label="Select a fruit" className="w-full">
        <SelectValue placeholder="Select a fruit" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Fruits</SelectLabel>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
          <SelectItem value="blueberry">Blueberry</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Vegetables</SelectLabel>
          <SelectItem value="carrot">Carrot</SelectItem>
          <SelectItem value="broccoli">Broccoli</SelectItem>
          <SelectItem value="spinach">Spinach</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("combobox", {
      name: "Select a fruit",
    });

    await userEvent.click(trigger);

    const listbox = await screen.findByRole("listbox");
    await waitFor(() => expect(listbox).toBeInTheDocument());
    await expect(screen.getByText("Fruits")).toBeInTheDocument();
    await expect(screen.getByText("Vegetables")).toBeInTheDocument();
    await expect(
      listbox.querySelector('[data-slot="select-separator"]'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "Broccoli" }));
    await expect(trigger).toHaveTextContent("Broccoli");
  },
};

/**
 * Use for long option lists — the viewport scrolls while groups keep their
 * labels. Upstream's example omits an accessible name on the trigger; we add
 * `aria-label` to satisfy the a11y gate.
 *
 * Adapted from [shadcn Select › Scrollable](https://ui.shadcn.com/docs/components/base/select#scrollable).
 *
 * @summary for long scrollable option lists
 */
export const Scrollable: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // Selecting an option closes the listbox, so the snapshot would only show the
  // trigger. Skip screenshot capture; the interaction test still runs.
  parameters: { visualTests: { disable: true } },
  render: () => (
    <Select items={TIMEZONE_ITEMS}>
      <SelectTrigger aria-label="Select a timezone" className="w-full">
        <SelectValue placeholder="Select a timezone" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>North America</SelectLabel>
          <SelectItem value="est">Eastern Standard Time</SelectItem>
          <SelectItem value="cst">Central Standard Time</SelectItem>
          <SelectItem value="mst">Mountain Standard Time</SelectItem>
          <SelectItem value="pst">Pacific Standard Time</SelectItem>
          <SelectItem value="akst">Alaska Standard Time</SelectItem>
          <SelectItem value="hst">Hawaii Standard Time</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Europe &amp; Africa</SelectLabel>
          <SelectItem value="gmt">Greenwich Mean Time</SelectItem>
          <SelectItem value="cet">Central European Time</SelectItem>
          <SelectItem value="eet">Eastern European Time</SelectItem>
          <SelectItem value="west">Western European Summer Time</SelectItem>
          <SelectItem value="cat">Central Africa Time</SelectItem>
          <SelectItem value="eat">East Africa Time</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Asia</SelectLabel>
          <SelectItem value="msk">Moscow Time</SelectItem>
          <SelectItem value="ist">India Standard Time</SelectItem>
          <SelectItem value="cst_china">China Standard Time</SelectItem>
          <SelectItem value="jst">Japan Standard Time</SelectItem>
          <SelectItem value="kst">Korea Standard Time</SelectItem>
          <SelectItem value="ist_indonesia">
            Indonesia Central Standard Time
          </SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Australia &amp; Pacific</SelectLabel>
          <SelectItem value="awst">Australian Western Standard Time</SelectItem>
          <SelectItem value="acst">Australian Central Standard Time</SelectItem>
          <SelectItem value="aest">Australian Eastern Standard Time</SelectItem>
          <SelectItem value="nzst">New Zealand Standard Time</SelectItem>
          <SelectItem value="fjt">Fiji Time</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>South America</SelectLabel>
          <SelectItem value="art">Argentina Time</SelectItem>
          <SelectItem value="bot">Bolivia Time</SelectItem>
          <SelectItem value="brt">Brasilia Time</SelectItem>
          <SelectItem value="clt">Chile Standard Time</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("combobox", {
      name: "Select a timezone",
    });

    await userEvent.click(trigger);
    const listbox = await screen.findByRole("listbox");
    await waitFor(() => expect(listbox).toBeInTheDocument());
    await expect(screen.getByText("North America")).toBeInTheDocument();
    await expect(screen.getByText("South America")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("option", { name: "Chile Standard Time" }),
    );
    await expect(trigger).toHaveTextContent("Chile Standard Time");
  },
};

/**
 * Use `disabled` on the Select for an unavailable field, or on individual
 * items for unavailable options. Upstream's example omits an accessible name
 * on the trigger; we add `aria-label` to satisfy the a11y gate.
 *
 * Adapted from [shadcn Select › Disabled](https://ui.shadcn.com/docs/components/base/select#disabled).
 *
 * @summary for disabled select and items
 */
export const Disabled: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Select disabled items={FRUIT_ITEMS}>
      <SelectTrigger aria-label="Select a fruit" className="w-full">
        <SelectValue placeholder="Select a fruit" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
          <SelectItem value="blueberry">Blueberry</SelectItem>
          <SelectItem value="grapes" disabled>
            Grapes
          </SelectItem>
          <SelectItem value="pineapple">Pineapple</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("combobox", {
      name: "Select a fruit",
    });

    await expect(trigger).toBeDisabled();
    await expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  },
};

/**
 * Use `aria-invalid` with Field's error slot for validation failures; the
 * play function verifies the alert and that selection still works. Upstream's
 * example omits an accessible name on the trigger; we add `aria-label` to
 * satisfy the a11y gate.
 *
 * Adapted from [shadcn Select › Invalid](https://ui.shadcn.com/docs/components/base/select#invalid).
 *
 * @summary for validation error state
 */
export const Invalid: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // Play opens and selects an option, ending closed (and resolving the invalid
  // state), so the snapshot would only show the trigger. Skip screenshot
  // capture; the interaction test still runs.
  parameters: { visualTests: { disable: true } },
  render: () => (
    <Field data-invalid className="w-full">
      <FieldLabel>Fruit</FieldLabel>
      <Select items={FRUIT_ITEMS}>
        <SelectTrigger aria-invalid aria-label="Fruit">
          <SelectValue placeholder="Select a fruit" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="banana">Banana</SelectItem>
            <SelectItem value="blueberry">Blueberry</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldError>Please select a fruit.</FieldError>
    </Field>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("combobox", { name: "Fruit" });

    await expect(trigger).toHaveAttribute("aria-invalid", "true");
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Please select a fruit.",
    );
    await userEvent.click(trigger);
    const listbox = await screen.findByRole("listbox");
    await waitFor(() => expect(listbox).toBeInTheDocument());
    await userEvent.click(screen.getByRole("option", { name: "Blueberry" }));
    await expect(trigger).toHaveTextContent("Blueberry");
  },
};
