// Owned preview. Every story's `play` mutates the component past its
// initial render — previews compile the story render only, play never runs
// — so the storybook reference (captured post-play) diverges from a plain
// render of the story source. This mirrors each story's FINAL rendered
// state instead of its initial args:
//
// - Basic: `play` opens the listbox and deliberately leaves it open
//   ("Leave the listbox open so the visual snapshot captures it") — forced
//   with `defaultOpen`.
// - AlignItem: `play` toggles the Align Item switch off, then selects
//   "Pineapple" from the popper-mode listbox — the switch defaults to
//   `defaultChecked={false}` and the select to `defaultValue="pineapple"`.
// - Groups: `play` selects "Broccoli" — `defaultValue="broccoli"`.
// - Scrollable: `play` selects "Chile Standard Time" —
//   `defaultValue="clt"`.
// - Disabled: `play` only asserts the disabled state; nothing changes, so
//   this stays a plain, unforced render.
// - Invalid: `play` selects "Blueberry" (the invalid state itself is
//   static, not cleared by selection) — `defaultValue="blueberry"`.
import * as React from "react";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Switch } from "@workspace/ui/components/switch";

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

export const Basic = () => (
  <Select items={FRUIT_ITEMS} defaultOpen>
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
);

export const AlignItem = () => (
  <FieldGroup className="w-full">
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor="align-item">Align Item</FieldLabel>
        <FieldDescription>
          Toggle to align the item with the trigger.
        </FieldDescription>
      </FieldContent>
      <Switch id="align-item" defaultChecked={false} />
    </Field>
    <Field>
      <Select defaultValue="pineapple" items={FRUIT_ITEMS}>
        <SelectTrigger aria-label="Selected fruit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
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

export const Groups = () => (
  <Select items={FRUIT_VEG_ITEMS} defaultValue="broccoli">
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
);

export const Scrollable = () => (
  <Select items={TIMEZONE_ITEMS} defaultValue="clt">
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
);

export const Disabled = () => (
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
);

export const Invalid = () => (
  <Field data-invalid className="w-full">
    <FieldLabel>Fruit</FieldLabel>
    <Select items={FRUIT_ITEMS} defaultValue="blueberry">
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
);
