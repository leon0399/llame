"use client";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group";
import { SearchIcon, XIcon } from "lucide-react";

type SearchFilterInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** e.g. stopPropagation inside menus (typeahead steals keystrokes). */
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Placement classes for the wrapper (padding, a divider); not the field. */
  className?: string;
  /** Take focus on mount, for a field opened by its own button. */
  focusOnMount?: boolean;
  /** For a field that opens on request: the clear button is always shown
   *  and, like Escape, clears the query and closes the field. */
  onClose?: () => void;
  /** Accessible name; placeholder alone is not a reliable one. */
  "aria-label"?: string;
};

/** The trailing × that clears the query (and closes an on-request field). */
function ClearButton({ onClear }: { onClear: () => void }) {
  return (
    <InputGroupAddon align="inline-end">
      <InputGroupButton size="icon-xs" onClick={onClear}>
        <XIcon />
        <span className="sr-only">Clear search</span>
      </InputGroupButton>
    </InputGroupAddon>
  );
}

/** Closes an emptied field once focus leaves the whole control, since it has
 *  nothing left to show; moving between the field and its clear button is
 *  not leaving it. */
function closeIfLeft(
  event: React.FocusEvent<HTMLElement>,
  value: string,
  onClose: (() => void) | undefined,
) {
  if (value !== "" || event.currentTarget.contains(event.relatedTarget)) return;
  onClose?.();
}

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
  focusOnMount = false,
  onClose,
  "aria-label": ariaLabel,
}: SearchFilterInputProps) {
  const clear = () => {
    onChange("");
    onClose?.();
  };
  return (
    <div
      className={className}
      onBlur={(event) => closeIfLeft(event, value, onClose)}
    >
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (onClose && event.key === "Escape") clear();
            onKeyDown?.(event);
          }}
          placeholder={placeholder}
          aria-label={ariaLabel ?? placeholder}
          // Opened by its own button, so focus belongs here at once.
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={focusOnMount}
        />
        {(value !== "" || onClose) && <ClearButton onClear={clear} />}
      </InputGroup>
    </div>
  );
}
