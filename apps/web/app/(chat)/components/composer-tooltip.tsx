"use client";

import type { ReactElement, ReactNode } from "react";

import { Kbd } from "@workspace/ui/components/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

/**
 * A composer control with a hover/focus tooltip naming it, plus its keyboard
 * shortcut where one exists, styled like the sidebar rail's "Search". `render`
 * is the control itself; a popup trigger (menu, popover) composes as
 * `render={<PopoverTrigger render={<Button />} />}`.
 *
 * @summary composer control with a named tooltip and optional shortcut
 */
export function ComposerTooltip({
  label,
  shortcut,
  render,
  children,
}: {
  label: string;
  shortcut?: string;
  render: ReactElement;
  children?: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={render}>{children}</TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
