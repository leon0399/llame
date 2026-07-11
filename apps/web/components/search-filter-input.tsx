"use client";

import { SearchIcon, XIcon } from "lucide-react";

// Borderless cmdk-style filter row: leading magnifier, bare transparent
// input, trailing "x" clear (only while there's text). ONE implementation
// for every embedded filter (the chat menu's project submenu, the projects
// rail, …) — no Input primitive, its border/ring chrome is wrong inside
// menus and rail headers.
export function SearchFilterInput({
  value,
  onChange,
  placeholder,
  onKeyDown,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** e.g. stopPropagation inside Radix menus (typeahead steals keystrokes). */
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 ${className ?? "px-2 py-1.5"}`}>
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      {value !== "" && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
        >
          <XIcon className="size-4" />
          <span className="sr-only">Clear search</span>
        </button>
      )}
    </div>
  );
}
