"use client";

import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";

import { cn } from "@workspace/ui/lib/utils";

/**
 * Accordion is a vertically stacked set of interactive headings that each
 * reveal a section of content. Use `type="single"` (optionally with
 * `collapsible`, so the open item can be closed again) to let only one item
 * be open at a time, or `type="multiple"` to let several stay open together.
 * Those two props form a discriminated union upstream (`collapsible` and a
 * string `value`/`defaultValue` only exist in `single` mode; `multiple` mode
 * takes string-array `value`/`defaultValue` instead) — TypeScript interfaces
 * can't `extends` a union, so this fork documents them here in prose rather
 * than duplicating Radix's exact union shape in a local Props interface. See
 * the [Radix Accordion API](https://www.radix-ui.com/primitives/docs/components/accordion#api-reference)
 * for the full prop reference.
 *
 * Vendored from the [shadcn/ui Accordion](https://ui.shadcn.com/docs/components/radix/accordion).
 *
 * @summary for vertically stacked, single- or multi-open disclosure sections
 */
function Accordion({
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}

interface AccordionItemProps
  extends React.ComponentProps<typeof AccordionPrimitive.Item> {
  /** Unique identifier for this item within the accordion; required. */
  value: string;
  /** Whether this item is non-interactive and cannot be opened or closed. */
  disabled?: boolean;
}

function AccordionItem({ className, ...props }: AccordionItemProps) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b last:border-b-0", className)}
      {...props}
    />
  );
}

/**
 * AccordionTrigger is the clickable heading that toggles its AccordionItem's
 * content open or closed. Render it as the direct child of an AccordionItem.
 *
 * @summary for the clickable heading that opens or closes an item
 */
function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon className="pointer-events-none size-4 shrink-0 translate-y-0.5 text-muted-foreground transition-transform duration-200" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

/**
 * AccordionContent is the collapsible region revealed while its
 * AccordionItem is open, animated between the `accordion-down` and
 * `accordion-up` keyframes.
 *
 * @summary for an item's collapsible revealed content
 */
function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
      {...props}
    >
      <div className={cn("pt-0 pb-4", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
