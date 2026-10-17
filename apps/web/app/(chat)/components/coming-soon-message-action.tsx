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
 * hidden, with the sidebar placeholders' "coming soon" tooltip. It stays
 * focusable (`aria-disabled`, not native `disabled`), so the tooltip answers
 * focus as well as hover, and focusing it reveals the hover-only action row.
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
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled
            focusableWhenDisabled
          />
        }
      >
        <Icon data-icon="inline-start" aria-hidden="true" />
        <span className="text-trim-cap">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{`${label} — coming soon`}</TooltipContent>
    </Tooltip>
  );
}
