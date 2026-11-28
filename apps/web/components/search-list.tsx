"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { CheckIcon } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  useCommandState,
} from "@workspace/ui/components/command";

/*
 * A list with its own search: the input on top filters only these items.
 * Shared by the composer's project and folder pickers and the chat menu's
 * "Add to project". Choices that must stay reachable (clearing the choice,
 * creating a new item) are kept through a search and never behind a scroll.
 */

/** Keys typed into the list stay in it: a menu around it would otherwise
 *  move its own highlight on arrows, jump on typed letters, and close a
 *  submenu on ArrowLeft, which the search field needs to move its cursor.
 *  Escape alone still reaches the menu, to close it. */
function keepKeysInside(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Escape") event.stopPropagation();
}

export function SearchList({
  placeholder,
  first,
  children,
  last,
}: {
  placeholder: string;
  first?: ReactNode;
  children: ReactNode;
  last?: ReactNode;
}) {
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- the listener only stops propagation; cmdk's own input and items are the interactive parts
    <div onKeyDown={keepKeysInside}>
      {/* cmdk names its input with this hidden label. */}
      <Command label={placeholder}>
        <CommandInput
          placeholder={placeholder}
          // Deliberate: the list opens to be searched, so typing starts at
          // once, in a popover and in a menu's submenu alike.
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
        <CommandList>
          {first}
          {/* cmdk sorts a search's matching groups to the end of their
              parent; their own container keeps them above `last`. */}
          <div>{children}</div>
          <CommandEmpty>No matches.</CommandEmpty>
          {last}
        </CommandList>
      </Command>
    </div>
  );
}

/** The trailing check that marks the current choice; reserved space when
 *  not chosen, so names line up. Decorative: the item itself carries
 *  `aria-checked`. */
export function SearchListCheck({ on }: { on: boolean }) {
  return (
    <CheckIcon
      aria-hidden
      className={on ? "ml-auto size-4" : "ml-auto size-4 opacity-0"}
    />
  );
}

/** The rule between the kept entries and the results. Decorative, so it is
 *  hidden from assistive technology (a separator role inside a listbox is
 *  not allowed), and hidden while a search is typed, like cmdk's own
 *  separator, so a search with no match shows no empty section. */
function SearchListDivider() {
  const search = useCommandState((state) => state.search);

  if (search !== "") return null;

  return <div aria-hidden="true" className="-mx-1 my-1 h-px bg-border" />;
}

/** An entry kept through any search: the "none" option first ("No
 *  project"), checked while nothing is chosen, with a rule under it; or an
 *  action last ("New project"), with a rule above it. The rules hide while a
 *  search is typed, so a search with no match shows no empty section. */
export function SearchListAction({
  label,
  icon,
  onSelect,
  position,
  disabled = false,
  checked,
}: {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  position: "first" | "last";
  disabled?: boolean;
  /** Set for an option, so it carries the same check as the others. */
  checked?: boolean;
}) {
  return (
    <>
      {position === "last" ? <SearchListDivider /> : null}
      <CommandGroup forceMount>
        <CommandItem
          forceMount
          value={label}
          onSelect={onSelect}
          disabled={disabled}
          aria-checked={checked}
        >
          {icon}
          {label}
          {checked === undefined ? null : <SearchListCheck on={checked} />}
        </CommandItem>
      </CommandGroup>
      {position === "first" ? <SearchListDivider /> : null}
    </>
  );
}

/** The owner's projects as search-list items, the chosen one checked. */
export function ProjectSearchItems({
  projects,
  selectedId,
  onSelect,
}: {
  projects: ReadonlyArray<{ id: string; name: string }>;
  selectedId: string | null;
  onSelect: (projectId: string) => void;
}) {
  if (projects.length === 0) return null;

  return (
    <CommandGroup heading="Projects">
      {projects.map((row) => (
        <CommandItem
          key={row.id}
          value={`${row.name} ${row.id}`}
          onSelect={() => onSelect(row.id)}
          aria-checked={row.id === selectedId}
        >
          <span className="truncate">{row.name}</span>
          <SearchListCheck on={row.id === selectedId} />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
