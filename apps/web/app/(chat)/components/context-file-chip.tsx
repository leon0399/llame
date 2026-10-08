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

export type ContextFileState =
  | "loaded"
  | "imported"
  | "truncated"
  | "denied"
  | "failed"
  | "omitted";

const STATE_LABEL: Record<ContextFileState, string> = {
  loaded: "Loaded",
  imported: "Imported",
  truncated: "Truncated",
  denied: "Denied",
  failed: "Failed",
  omitted: "Omitted",
};

type ContextFileChipProps = {
  kind: ContextFileKind;
  path: string;
  detail?: string;
  state: ContextFileState;
};
/** One owner-visible path or locator with its resolution outcome. */
export function ContextFileChip({
  kind,
  path,
  detail,
  state,
}: ContextFileChipProps) {
  const label = STATE_LABEL[state];
  const negative =
    state === "denied" || state === "failed" || state === "omitted";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            // Keep every state outlined so muted states stay visible on the
            // bg-secondary user bubble.
            variant="outline"
            className="max-w-64"
            aria-label={`${label} ${kind} file: ${path}`}
            tabIndex={0}
          />
        }
      >
        {negative ? <BanIcon /> : <FileTextIcon />}
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
