"use client";

import type { ComponentProps } from "react";

import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

/** A ghost icon button labelled by its tooltip (and, for assistive tech, by
 *  a screen-reader-only span). `children` is the icon. */
export function IconButtonTooltip({
  label,
  children,
  side,
  align,
  ...buttonProps
}: ComponentProps<typeof Button> &
  Pick<ComponentProps<typeof TooltipContent>, "side" | "align"> & {
    label: string;
  }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon" {...buttonProps} />}
      >
        {children}
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent side={side} align={align}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
