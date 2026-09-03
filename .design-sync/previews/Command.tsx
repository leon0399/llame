// Owned preview. Both stories' `play` functions mutate state past the
// initial render — previews compile the story render only, play never runs
// — so the storybook reference (captured post-play) diverges from a plain
// render of the story source:
//
// - Basic: `play` types "zzzznope" into the search input, ending on the
//   empty state ("No results found."). cmdk's `CommandInput` only syncs its
//   internal filter state from a *controlled* `value` (its own `defaultValue`
//   has no effect on filtering — verified in cmdk's source), so this passes
//   `value="zzzznope"` with a no-op `onValueChange` to reach the same
//   filtered, empty-state render.
// - AsDialog: `play` starts with the palette closed, then opens it with the
//   ⌘J shortcut and leaves it open — forced here with `defaultOpen` on
//   `CommandDialog` (which forwards it to the underlying `Dialog`).
import * as React from "react";
import {
  CalculatorIcon,
  CalendarIcon,
  CreditCardIcon,
  SettingsIcon,
  SmileIcon,
  UserIcon,
} from "lucide-react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@workspace/ui/components/command";

export const Basic = () => (
  <Command label="Command menu" className="rounded-lg border">
    <CommandInput
      placeholder="Type a command or search..."
      value="zzzznope"
      onValueChange={() => {}}
    />
    <CommandList>
      <CommandEmpty>No results found.</CommandEmpty>
      <CommandGroup heading="Suggestions">
        <CommandItem>
          <CalendarIcon />
          <span>Calendar</span>
        </CommandItem>
        <CommandItem>
          <SmileIcon />
          <span>Search Emoji</span>
        </CommandItem>
        <CommandItem disabled>
          <CalculatorIcon />
          <span>Calculator</span>
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Settings">
        <CommandItem>
          <UserIcon />
          <span>Profile</span>
          <CommandShortcut>⌘P</CommandShortcut>
        </CommandItem>
        <CommandItem>
          <CreditCardIcon />
          <span>Billing</span>
          <CommandShortcut>⌘B</CommandShortcut>
        </CommandItem>
        <CommandItem>
          <SettingsIcon />
          <span>Settings</span>
          <CommandShortcut>⌘S</CommandShortcut>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
);

export const AsDialog = () => (
  <>
    <p className="text-sm text-muted-foreground">
      Press{" "}
      <kbd className="pointer-events-none inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100 select-none">
        <span className="text-xs">⌘</span>J
      </kbd>
    </p>
    <CommandDialog defaultOpen commandProps={{ label: "Command menu" }}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Suggestions">
          <CommandItem>
            <CalendarIcon />
            <span>Calendar</span>
          </CommandItem>
          <CommandItem>
            <SmileIcon />
            <span>Search Emoji</span>
          </CommandItem>
          <CommandItem>
            <CalculatorIcon />
            <span>Calculator</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          <CommandItem>
            <UserIcon />
            <span>Profile</span>
            <CommandShortcut>⌘P</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <CreditCardIcon />
            <span>Billing</span>
            <CommandShortcut>⌘B</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <SettingsIcon />
            <span>Settings</span>
            <CommandShortcut>⌘S</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  </>
);
