"use client";

import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { TypeIcon, Code2Icon, ChevronDownIcon } from "lucide-react";
import { type CSSProperties, type ReactNode } from "react";

export interface FontOption {
  value: string;
  label: string;
  cssVar: string;
}

interface FontSwitcherProps {
  options: ReadonlyArray<FontOption>;
  currentValue: string;
  onValueChange: (value: string) => void;
  icon?: ReactNode;
  previewText?: string;
  className?: string;
}

function FontSwitcherTrigger({
  currentOption,
  icon,
  className,
}: {
  currentOption: FontOption | undefined;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <DropdownMenuTrigger
      render={<Button variant="outline" size="sm" className={className} />}
    >
      {icon}
      {/*
        The chosen face is a runtime value (the appearance service resolves it
        per user), so it travels as a CSS custom property and the class only
        names where it applies — a static utility can never spell it out.
      */}
      <span
        className="flex-1 text-left font-(family-name:--font-family)"
        style={
          // SAFETY: `--font-family` is a CSS custom property this element's own
          // class reads (`font-(family-name:--font-family)`); React's
          // `CSSProperties` type has no way to name a custom property, so
          // widening to accept an arbitrary key is the only way to pass it
          // through inline `style`.
          { "--font-family": currentOption?.cssVar } as CSSProperties
        }
      >
        {currentOption?.label}
      </span>
      <ChevronDownIcon className="h-4 w-4 ml-2 opacity-50" />
    </DropdownMenuTrigger>
  );
}

function FontOptionItem({
  option,
  previewText,
}: {
  option: FontOption;
  previewText: string;
}) {
  return (
    <DropdownMenuRadioItem
      value={option.value}
      className="flex items-center justify-between"
    >
      <span
        className="flex-1 font-(family-name:--font-family)"
        style={
          // SAFETY: `--font-family` is a CSS custom property this element's own
          // class reads (`font-(family-name:--font-family)`); React's
          // `CSSProperties` type has no way to name a custom property, so
          // widening to accept an arbitrary key is the only way to pass it
          // through inline `style`.
          { "--font-family": option.cssVar } as CSSProperties
        }
      >
        {option.label}
      </span>
      <span
        className="text-xs text-muted-foreground ml-2 font-(family-name:--font-family)"
        style={
          // SAFETY: same custom property as the label above, same reason.
          { "--font-family": option.cssVar } as CSSProperties
        }
      >
        {previewText}
      </span>
    </DropdownMenuRadioItem>
  );
}

export function FontSwitcher({
  options,
  currentValue,
  onValueChange,
  icon,
  previewText = "Aa",
  className,
}: FontSwitcherProps) {
  const currentOption = options.find((option) => option.value === currentValue);

  return (
    <DropdownMenu>
      <FontSwitcherTrigger
        currentOption={currentOption}
        icon={icon}
        className={className}
      />
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuRadioGroup
          value={currentValue}
          onValueChange={onValueChange}
        >
          {options.map((option) => (
            <FontOptionItem
              key={option.value}
              option={option}
              previewText={previewText}
            />
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Convenience components for common use cases
interface InterfaceFontSwitcherProps {
  options: ReadonlyArray<FontOption>;
  currentValue: string;
  onValueChange: (value: string) => void;
  className?: string;
}

export function InterfaceFontSwitcher(props: InterfaceFontSwitcherProps) {
  return (
    <FontSwitcher
      {...props}
      icon={<TypeIcon className="h-4 w-4 mr-2" />}
      previewText="Aa"
    />
  );
}

export function CodeFontSwitcher(props: InterfaceFontSwitcherProps) {
  return (
    <FontSwitcher
      {...props}
      icon={<Code2Icon className="h-4 w-4 mr-2" />}
      previewText="</>"
    />
  );
}
