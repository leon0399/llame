"use client";

import type { LucideIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

/**
 * A per-message action whose feature has not shipped: shown disabled, never
 * hidden, with the sidebar placeholders' "coming soon" tooltip. Like those
 * placeholders it is out of the tab order. A natively disabled button
 * receives no pointer events, so the tooltip hangs off a wrapping span.
 *
 * @summary disabled message action with a "coming soon" tooltip
 */
export function ComingSoonMessageAction({
  label,
  icon: Icon,
}: {
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled
        >
          <Icon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{`${label} — coming soon`}</TooltipContent>
    </Tooltip>
  );
}
