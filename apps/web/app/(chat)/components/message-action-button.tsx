"use client";

import type { ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

type MessageActionButtonProps = Omit<
  ComponentProps<typeof Button>,
  "children" | "size" | "variant" | "aria-label"
> & {
  /** The accessible name and the tooltip. */
  label: string;
  icon: LucideIcon;
};

/**
 * One icon-only action in a message's action row. The label is the button's
 * accessible name and its tooltip, so the row stays one line on a narrow
 * screen instead of wrapping a run of labelled buttons.
 *
 * @summary icon-only message action with its label as name and tooltip
 */
export function MessageActionButton({
  label,
  icon: Icon,
  ...buttonProps
}: MessageActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            {...buttonProps}
          />
        }
      >
        <Icon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
