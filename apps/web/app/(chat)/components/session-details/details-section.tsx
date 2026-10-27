"use client";

import { useState, type ReactNode, type TransitionEvent } from "react";
import { ChevronRightIcon, GripVerticalIcon } from "lucide-react";
import type { DragControls } from "framer-motion";

import { Button } from "@workspace/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@workspace/ui/components/sidebar";

/** Drag handle at the title row's right end, shown while the row is hovered
 *  or holds keyboard focus. */
function SectionDragHandle({
  title,
  dragControls,
}: {
  title: string;
  dragControls: DragControls;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={`Drag to reorder ${title}`}
      className="absolute top-1 right-1 hidden cursor-grab active:cursor-grabbing group-hover/title:flex group-has-focus-visible/title:flex"
      onPointerDown={(event) => {
        event.preventDefault();
        dragControls.start(event);
      }}
    >
      <GripVerticalIcon />
    </Button>
  );
}

/**
 * The full-width fold toggle, styled as the group's label: a chevron that
 * turns down while open, the title, and — only while folded — a one-line
 * summary at the right end, where the drag handle takes over on hover.
 */
function SectionTitle({
  title,
  badge,
  summary,
  open,
}: {
  title: string;
  badge: ReactNode;
  summary: ReactNode;
  open: boolean;
}) {
  return (
    <SidebarGroupLabel render={<CollapsibleTrigger />} className="w-full">
      <ChevronRightIcon
        aria-hidden="true"
        className="mr-1 transition-transform duration-200 in-data-panel-open:rotate-90"
      />
      <span className="truncate">{title}</span>
      {badge === undefined ? null : <span className="ml-2">{badge}</span>}
      {open ? null : (
        <span className="ml-auto truncate pl-2 font-normal group-hover/title:invisible group-has-focus-visible/title:invisible">
          {summary}
        </span>
      )}
    </SidebarGroupLabel>
  );
}

/**
 * Height animation only for the fold itself. The panel animates its height
 * from a measured value, so leaving that on would also animate every change
 * to its content — a row arriving after a load — and clip the rows' focus
 * rings with the overflow it needs. It is switched on when the user folds or
 * unfolds and off once that transition ends, leaving the open panel at its
 * natural height.
 */
function useFoldAnimation(onOpenChange: (open: boolean) => void) {
  const [animating, setAnimating] = useState(false);
  return {
    animating,
    onOpenChange: (next: boolean) => {
      setAnimating(true);
      onOpenChange(next);
    },
    // Rows inside transition too (hover fills); only the panel's own
    // height transition ends the fold.
    onTransitionEnd: (event: TransitionEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) setAnimating(false);
    },
  };
}

/**
 * One session details section: a full-width sidebar group, folded from its
 * title row (animated) and reordered by the title row's drag handle.
 */
export function DetailsSection({
  title,
  badge,
  summary,
  open,
  onOpenChange,
  dragControls,
  children,
}: {
  title: string;
  /** Shown beside the title, e.g. a demo chip. */
  badge?: ReactNode;
  summary: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dragControls: DragControls;
  children: ReactNode;
}) {
  const fold = useFoldAnimation(onOpenChange);

  return (
    <Collapsible open={open} onOpenChange={fold.onOpenChange}>
      <SidebarGroup>
        <div className="group/title relative">
          <SectionTitle
            title={title}
            badge={badge}
            summary={summary}
            open={open}
          />
          <SectionDragHandle title={title} dragControls={dragControls} />
        </div>
        <CollapsibleContent
          animated={fold.animating}
          onTransitionEnd={fold.onTransitionEnd}
        >
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
