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
        ],
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Select>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  render: () => (
    <Select>
      <SelectTrigger aria-label="Select a fruit" className="w-full max-w-48">
        <SelectValue placeholder="Select a fruit" />
      </SelectTrigger>
      <SelectContent aria-label="Fruit options">
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
    await waitFor(() => expect(listbox).toHaveAttribute("data-state", "open"));
    await expect(screen.getByText("Fruits")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("option", { name: "Banana" }));
    await expect(trigger).toHaveTextContent("Banana");
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
  },
};

function SelectAlignItemDemo() {
  const [alignItemWithTrigger, setAlignItemWithTrigger] = React.useState(true);

  return (
    <FieldGroup className="w-full max-w-xs">
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
        <Select defaultValue="banana">
          <SelectTrigger aria-label="Selected fruit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            aria-label="Fruit options"
            position={alignItemWithTrigger ? "item-aligned" : "popper"}
          >
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
}

export const AlignItem: Story = {
  // `layout: "centered"` (the file default) wraps stories in a flex container
  // with no defined width. This demo's `w-full max-w-xs` FieldGroup has
  // nothing to size itself against there and collapses to 0 width.
  // `padded` gives it a real width to fill (verified: 320px, matching
  // max-w-xs, vs. 0px under "centered").
  parameters: { layout: "padded" },
  render: () => <SelectAlignItemDemo />,
  play: async ({ canvas, userEvent }) => {
    const alignItem = canvas.getByRole("switch", { name: "Align Item" });
    const trigger = canvas.getByRole("combobox", {
      name: "Selected fruit",
    });

    await expect(alignItem).toBeChecked();
    await userEvent.click(trigger);
    const itemAlignedContent = await screen.findByRole("listbox");
    await waitFor(() =>
      expect(itemAlignedContent).toHaveAttribute("data-state", "open"),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );

    await userEvent.click(alignItem);
    await expect(alignItem).not.toBeChecked();
    await userEvent.click(trigger);
    const popperContent = await screen.findByRole("listbox");
    await waitFor(() =>
      expect(popperContent).toHaveAttribute("data-state", "open"),
    );
    await userEvent.click(screen.getByRole("option", { name: "Pineapple" }));
    await expect(trigger).toHaveTextContent("Pineapple");
  },
};

export const Groups: Story = {
  render: () => (
    <Select>
      <SelectTrigger aria-label="Select a fruit" className="w-full max-w-48">
        <SelectValue placeholder="Select a fruit" />
      </SelectTrigger>
      <SelectContent aria-label="Fruit and vegetable options">
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
    await waitFor(() => expect(listbox).toHaveAttribute("data-state", "open"));
    await expect(screen.getByText("Fruits")).toBeInTheDocument();
    await expect(screen.getByText("Vegetables")).toBeInTheDocument();
    await expect(
      listbox.querySelector('[data-slot="select-separator"]'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "Broccoli" }));
    await expect(trigger).toHaveTextContent("Broccoli");
  },
};

export const Scrollable: Story = {
  render: () => (
    <Select>
      <SelectTrigger aria-label="Select a timezone" className="w-full max-w-64">
        <SelectValue placeholder="Select a timezone" />
      </SelectTrigger>
      <SelectContent aria-label="Timezone options">
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
    await waitFor(() => expect(listbox).toHaveAttribute("data-state", "open"));
    await expect(screen.getByText("North America")).toBeInTheDocument();
    await expect(screen.getByText("South America")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("option", { name: "Chile Standard Time" }),
    );
    await expect(trigger).toHaveTextContent("Chile Standard Time");
  },
};

export const Disabled: Story = {
  render: () => (
    <Select disabled>
      <SelectTrigger aria-label="Select a fruit" className="w-full max-w-48">
        <SelectValue placeholder="Select a fruit" />
      </SelectTrigger>
      <SelectContent aria-label="Fruit options">
        <SelectGroup>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
          <SelectItem value="blueberry">Blueberry</SelectItem>
          <SelectItem disabled value="grapes">
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

export const Invalid: Story = {
  render: () => (
    <Field data-invalid className="w-full max-w-48">
      <FieldLabel>Fruit</FieldLabel>
      <Select>
        <SelectTrigger aria-invalid aria-label="Fruit">
          <SelectValue placeholder="Select a fruit" />
        </SelectTrigger>
        <SelectContent aria-label="Fruit options">
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
    await waitFor(() => expect(listbox).toHaveAttribute("data-state", "open"));
    await userEvent.click(screen.getByRole("option", { name: "Blueberry" }));
    await expect(trigger).toHaveTextContent("Blueberry");
  },
};
