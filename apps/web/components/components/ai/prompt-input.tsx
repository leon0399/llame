'use client';

import { Button } from '@workspace/ui/components/button';
// import {
//   Select,
//   SelectContent,
//   SelectItem,
//   SelectTrigger,
//   SelectValue,
// } from '@workspace/ui/components/select';
import { Textarea } from '@workspace/ui/components/textarea';
import { cn } from '@workspace/ui/lib/utils';
import { useAutoResizeTextarea } from '@workspace/ui/hooks/use-autoresize-textarea';
import { Children } from 'react';
import type {
  ComponentProps,
  HTMLAttributes,
  KeyboardEventHandler,
} from 'react';

export type PromptInputProps = HTMLAttributes<HTMLFormElement>;

export const PromptInput = ({ className, ...props }: PromptInputProps) => (
  <form
    className={cn(
      'w-full overflow-hidden rounded-xl border bg-background shadow-sm',
      className
    )}
    {...props}
  />
);

export type PromptInputTextareaProps = ComponentProps<typeof Textarea> & {
  minHeight?: number;
  maxHeight?: number;
  submitBehavior?: 'enter' | 'shift-enter';
};

export const PromptInputTextarea = ({
  onChange,
  className,
  placeholder = 'What would you like to know?',
  minHeight = 48,
  maxHeight = 164,
  submitBehavior = 'enter',
  ...props
}: PromptInputTextareaProps) => {
  const textareaRef = useAutoResizeTextarea({
    minHeight,
    maxHeight,
  });

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    // @TODO: allow to configure enter key behavior
    if (submitBehavior === 'enter' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form) {
        form.requestSubmit();
      }
    }

    if (submitBehavior === 'shift-enter' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form) {
        form.requestSubmit();
      }
    }
  };

  return (
    <Textarea
      name="message"
      placeholder={placeholder}
      ref={textareaRef}
      className={cn(
        'w-full resize-none rounded-none border-none p-3 shadow-none outline-none ring-0 focus-visible:ring-0',
        className
      )}
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
    className={cn('flex items-center justify-between p-1 border-t', className)}
    {...props}
  />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({ className, ...props }: PromptInputToolsProps) => (
  <div className={cn('flex items-center gap-1', className)} {...props} />
);

export type PromptInputButtonProps = ComponentProps<typeof Button>;

export const PromptInputButton = ({
  variant = 'ghost',
  className,
  size,
  ...props
}: PromptInputButtonProps) => {
  const newSize =
    (size ?? Children.count(props.children) > 1) ? 'default' : 'icon';

  return (
    <Button
      type="button"
      variant={variant}
      size={newSize}
      className={cn(
        'shrink-0 gap-1.5 text-muted-foreground',
        newSize === 'default' && 'px-3',
        className
      )}
      {...props}
    />
  );
};

export type PromptInputSubmitProps = ComponentProps<typeof Button>;

export const PromptInputSubmit = ({
  className,
  variant = 'ghost',
  size = 'icon',
  ...props
}: PromptInputSubmitProps) => (
  <Button
    type="submit"
    variant={variant}
    size={size}
    className={cn('gap-1.5 text-muted-foreground', className)}
    {...props}
  />
);

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
