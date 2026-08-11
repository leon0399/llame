"use client";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group";
import { SearchIcon, XIcon } from "lucide-react";

/**
 * SearchFilterInput is the ONE embedded filter row (the chat menu's project
 * submenu, the projects rail, …) — a shared `InputGroup` with a leading
 * magnifier and a trailing clear button, so the focus ring belongs to the whole
 * field instead of hugging a bare input inside a menu.
 *
 * @summary the shared search/filter field for menus and rail headers
 */
export function SearchFilterInput({
  value,
  onChange,
  placeholder,
  onKeyDown,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** e.g. stopPropagation inside menus (typeahead steals keystrokes). */
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Placement classes for the wrapper (padding, a divider); not the field. */
  className?: string;
  /** Accessible name; placeholder alone is not a reliable one. */
  "aria-label"?: string;
}) {
  return (
    <div className={className}>
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel ?? placeholder}
        />
        {value !== "" && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" onClick={() => onChange("")}>
              <XIcon />
              <span className="sr-only">Clear search</span>
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
    </div>
  );
}
