import { cn } from "@workspace/ui/lib/utils";

/**
 * Kbd renders a single keyboard key or shortcut token — e.g. inline help
 * text describing a shortcut, or alongside a button/tooltip label.
 *
 * @see https://ui.shadcn.com/docs/components/base/kbd
 * @summary for displaying a single keyboard key
 */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

/**
 * KbdGroup groups several `Kbd` keys into a single shortcut, such as a
 * modifier-key combo (⌘⇧B) or a `+`-joined key sequence (Ctrl + B).
 *
 * @summary for grouping several Kbd keys into one shortcut
 */
function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
