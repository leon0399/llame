"use client";

import { Button } from "@workspace/ui/components/button";
// import {
//   Select,
//   SelectContent,
//   SelectItem,
//   SelectTrigger,
//   SelectValue,
// } from '@workspace/ui/components/select';
import { InputGroupTextarea } from "@workspace/ui/components/input-group";
import { cn } from "@workspace/ui/lib/utils";
import { useAutoResizeTextarea } from "@workspace/ui/hooks/use-autoresize-textarea";
import { Children } from "react";
import type {
  ComponentProps,
  HTMLAttributes,
  KeyboardEventHandler,
} from "react";

export type PromptInputProps = HTMLAttributes<HTMLFormElement>;

export const PromptInput = ({ className, ...props }: PromptInputProps) => (
  <form
    className={cn(
      "w-full overflow-hidden rounded-xl border bg-background shadow-sm",
      className,
    )}
    {...props}
  />
);

export type PromptInputTextareaProps = ComponentProps<
  typeof InputGroupTextarea
> & {
  minHeight?: number;
  maxHeight?: number;
  submitBehavior?: "enter" | "shift-enter";
};

export const PromptInputTextarea = ({
  onChange,
  className,
  placeholder = "What would you like to know?",
  minHeight = 48,
  maxHeight = 164,
  submitBehavior = "enter",
  ...props
}: PromptInputTextareaProps) => {
  const textareaRef = useAutoResizeTextarea({
    minHeight,
    maxHeight,
  });

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key !== "Enter") return;
    // Enter-key behaviour is fixed by `submitBehavior`; it is not user-configurable.
    const shouldSubmit =
      submitBehavior === "enter" ? !e.shiftKey : e.metaKey || e.ctrlKey;
    if (!shouldSubmit) return;

    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  };

  return (
    // InputGroupTextarea is the design system's chromeless multi-line control:
    // it is the same control this file was hand-stripping (no radius, no
    // border, no ring, no shadow, no dark fill) for a container that owns the
    // chrome — the `PromptInput` form above. Nothing is restyled here; only
    // the auto-resize, submit-on-enter behaviour, and the caller's own classes
    // are added.
    <InputGroupTextarea
      name="message"
      placeholder={placeholder}
      ref={textareaRef}
      className={className}
      onChange={onChange}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
};

export type PromptInputToolbarProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputToolbar = ({
  className,
  ...props
}: PromptInputToolbarProps) => (
  <div
    className={cn("flex items-center justify-between p-1 border-t", className)}
    {...props}
  />
);

export type PromptInputButtonProps = ComponentProps<typeof Button>;

export const PromptInputButton = ({
  variant = "ghost",
  className,
  size,
  ...props
}: PromptInputButtonProps) => {
  // Parenthesised deliberately: `??` binds tighter than `?:`, so the
  // unparenthesised form `(size ?? count > 1) ? …` made ANY explicit `size` a
  // truthy string and always yielded "default" — silently ignoring the prop,
  // including `size="icon"`. Only the child count should pick the fallback.
  const newSize =
    size ?? (Children.count(props.children) > 1 ? "default" : "icon");

  return (
    <Button
      type="button"
      variant={variant}
      size={newSize}
      // Only `shrink-0`: the Button's own size and variant supply the gap,
      // the padding, and the ink (the variant list has no muted treatment,
      // so the toolbar's icons read as the Button's default ink).
      className={cn("shrink-0", className)}
      {...props}
    />
  );
};

// export type PromptInputModelSelectProps = ComponentProps<typeof Select>;

// export const PromptInputModelSelect = (props: PromptInputModelSelectProps) => (
//   <Select {...props} />
// );

// export type PromptInputModelSelectTriggerProps = ComponentProps<
//   typeof SelectTrigger
// >;

// export const PromptInputModelSelectTrigger = ({
//   className,
//   ...props
// }: PromptInputModelSelectTriggerProps) => (
//   <SelectTrigger
//     className={cn(
//       'border-none bg-transparent font-medium text-muted-foreground shadow-none transition-colors',
//       'hover:bg-accent hover:text-foreground [&[aria-expanded="true"]]:bg-accent [&[aria-expanded="true"]]:text-foreground',
//       className
//     )}
//     {...props}
//   />
// );

// export type PromptInputModelSelectContentProps = ComponentProps<
//   typeof SelectContent
// >;

// export const PromptInputModelSelectContent = ({
//   className,
//   ...props
// }: PromptInputModelSelectContentProps) => (
//   <SelectContent className={cn(className)} {...props} />
// );

// export type PromptInputModelSelectItemProps = ComponentProps<typeof SelectItem>;

// export const PromptInputModelSelectItem = ({
//   className,
//   ...props
// }: PromptInputModelSelectItemProps) => (
//   <SelectItem className={cn(className)} {...props} />
// );

// export type PromptInputModelSelectValueProps = ComponentProps<typeof SelectValue>;

// export const PromptInputModelSelectValue = ({
//   className,
//   ...props
// }: PromptInputModelSelectValueProps) => (
//   <SelectValue className={cn(className)} {...props} />
// );
