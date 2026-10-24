"use client";

import { AlertTriangleIcon, MapPinIcon } from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";

import type { BoundRootChipSummary } from "@/lib/services/project/start-location";

import {
  useBoundRootLocation,
  type BoundRootChat,
} from "./use-bound-root-location";

/** The one accessible sentence the read-only chip is announced with. */
function announcedLocation(summary: BoundRootChipSummary): string {
  const announced = [...summary.segments, summary.detail].filter(
    (part): part is string => part !== null,
  );
  const label = `Chat location: ${announced.join(". ")}`;
  return summary.warning === null
    ? label
    : `${label}. Warning: ${summary.warning}`;
}

/** The segments, the second line, and the warning, as the chip prints them. */
function BoundRootText({ summary }: { summary: BoundRootChipSummary }) {
  return (
    <span className="flex min-w-0 flex-col items-start">
      <span className="max-w-full truncate">
        {summary.segments.join(" · ")}
      </span>
      {summary.detail === null ? null : (
        <span className="max-w-full truncate">{summary.detail}</span>
      )}
      {summary.warning === null ? null : (
        <span className="max-w-full truncate text-destructive">
          {summary.warning}
        </span>
      )}
    </span>
  );
}

/**
 * The chat header's read-only location chip (design D10): the bound root of
 * this chat, printed from its own `workspace_root` rather than a resolver, so
 * it also names a root the catalog does not hold. A chat bound to nothing warns
 * instead of guessing — the owner resends a create or enters a Workspace later.
 *
 * A chat with neither a project nor a root has nothing to say here, so the chip
 * renders nothing.
 */
export function BoundRootChip({
  chat,
  className,
}: {
  chat: BoundRootChat | undefined;
  className?: string;
}) {
  const summary = useBoundRootLocation(
    chat ?? { projectId: null, workspaceRoot: null },
  );
  if (
    chat === undefined ||
    (chat.projectId === null && chat.workspaceRoot === null)
  ) {
    return null;
  }
  return (
    <span
      aria-label={announcedLocation(summary)}
      title={summary.warning ?? summary.detail ?? undefined}
      className={cn(
        "flex min-w-0 max-w-md items-start gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      {summary.warning === null ? (
        <MapPinIcon size={14} aria-hidden className="mt-0.5 shrink-0" />
      ) : (
        <AlertTriangleIcon
          size={14}
          aria-hidden
          className="mt-0.5 shrink-0 text-destructive"
        />
      )}
      <BoundRootText summary={summary} />
    </span>
  );
}
