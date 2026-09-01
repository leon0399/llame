"use client";

import { PinIcon, PinOffIcon } from "lucide-react";

import { HoverReveal, SidebarRowAction } from "@/components/hover-reveal";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

/**
 * A sidebar row's hover-reveal pin/unpin toggle — shared by ChatItem and
 * ProjectItem's list rows. A pinned row keeps its pin in layout; everything
 * else appears with hover, taking its width only then. The pinned rail
 * (AppSidebarPinned) has no equivalent button — every row there is already
 * pinned, so "Unpin" lives in its kebab menu instead.
 */
export function PinButton({
  isPinned,
  togglePin,
}: {
  isPinned: boolean;
  togglePin: () => void;
}) {
  return (
    <HoverReveal atRest={isPinned}>
      <Tooltip>
        <TooltipTrigger render={<SidebarRowAction onClick={togglePin} />}>
          {isPinned ? <PinOffIcon /> : <PinIcon />}
          <span className="sr-only">{isPinned ? "Unpin" : "Pin"}</span>
        </TooltipTrigger>
        <TooltipContent>{isPinned ? "Unpin" : "Pin"}</TooltipContent>
      </Tooltip>
    </HoverReveal>
  );
}
