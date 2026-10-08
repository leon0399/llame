"use client";

import type { ReactNode } from "react";

import { BanIcon, FileTextIcon } from "lucide-react";

import { Badge } from "@workspace/ui/components/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

export type ContextFileKind = "instruction" | "prompt";

type ContextFileChipProps = {
  kind: ContextFileKind;
  path: string;
  detail?: string;
  state: string;
  muted?: boolean;
};

/** One owner-visible path or locator with its resolution outcome. */
export function ContextFileChip({
  kind,
  path,
  detail,
  state,
  muted = false,
}: ContextFileChipProps) {
  const label = state.slice(0, 1).toUpperCase() + state.slice(1);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            className="max-w-64"
            aria-label={`${label} ${kind} file: ${path}`}
            tabIndex={0}
          />
        }
      >
        {muted ? <BanIcon /> : <FileTextIcon />}
        <span className="truncate">{path}</span>
        {state !== "imported" && state !== "loaded" && (
          <span className="shrink-0">{state}</span>
        )}
      </TooltipTrigger>
      <TooltipContent>{detail ?? path}</TooltipContent>
    </Tooltip>
  );
}

type ContextChipGroupProps = {
  icon: ReactNode;
  label: string;
  children: ReactNode;
};

/** Shared rail layout for owner-visible context item chips. */
export function ContextChipGroup({
  icon,
  label,
  children,
}: ContextChipGroupProps) {
  return (
    <div className="my-1 flex flex-wrap items-center gap-1">
      <Badge variant="outline">
        {icon}
        {label}
      </Badge>
      {children}
    </div>
  );
}
