"use client";

import { AtSignIcon, BanIcon, FileTextIcon } from "lucide-react";

import { Badge } from "@workspace/ui/components/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

import type { PromptImportsPayload } from "@/lib/services/chat/history";

/** How one `@` marker in the prompt figures in the disclosure: read whole,
 *  read up to the per-file cap, refused by the `read` permission group,
 *  failed to read, or skipped because the prompt carried more markers than
 *  the per-prompt cap. */
type PromptImportState =
  | "imported"
  | "truncated"
  | "denied"
  | "failed"
  | "omitted";

/** The accessible name per state — the badge truncates the visible locator,
 *  so the full locator lives in the label and the tooltip. */
const STATE_LABEL: Record<PromptImportState, string> = {
  imported: "Imported",
  truncated: "Truncated",
  denied: "Denied",
  failed: "Failed",
  omitted: "Omitted",
};

type PromptImportChipEntry = {
  /** Unique within a payload: the api records each locator once. */
  key: string;
  state: PromptImportState;
  locator: string;
  resolved: string | undefined;
};

/** Imports first in the prompt's marker order, then the omitted locators —
 *  each entry renders as its own badge. */
function chipEntries(
  payload: PromptImportsPayload,
): Array<PromptImportChipEntry> {
  return [
    ...payload.imports.map(
      (entry): PromptImportChipEntry => ({
        key: `import:${entry.locator}`,
        state:
          entry.outcome === "imported" && entry.truncated
            ? "truncated"
            : entry.outcome,
        locator: entry.locator,
        resolved: entry.resolved,
      }),
    ),
    ...(payload.omitted ?? []).map(
      (locator): PromptImportChipEntry => ({
        key: `omitted:${locator}`,
        state: "omitted",
        locator,
        resolved: undefined,
      }),
    ),
  ];
}

/** One marker entry: its locator, marked when it was not imported whole. A
 *  denied, failed, or omitted locator stays muted — the `secondary` surface,
 *  never the destructive variant — because each is a policy or capacity state
 *  the prompt already survived, not an error the user must act on, and Alert
 *  Red is reserved for destructive states (DESIGN.md §10). */
function PromptImportChip({ entry }: { entry: PromptImportChipEntry }) {
  const muted =
    entry.state === "denied" ||
    entry.state === "failed" ||
    entry.state === "omitted";
  const tooltip =
    entry.resolved !== undefined && entry.resolved !== entry.locator
      ? `${entry.locator} → ${entry.resolved}`
      : entry.locator;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant={muted ? "secondary" : "outline"}
            className="max-w-64"
            aria-label={`${STATE_LABEL[entry.state]} prompt file: ${entry.locator}`}
            tabIndex={0}
          />
        }
      >
        {muted ? <BanIcon /> : <FileTextIcon />}
        <span className="truncate">{entry.locator}</span>
        {entry.state !== "imported" && (
          <span className="shrink-0">{entry.state}</span>
        )}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The owner-facing chip for a `prompt-imports` context item: the `@` markers
 * a user prompt carried, each marked when the file was cut at the per-file
 * cap, denied by the `read` permission group, failed to read, or skipped past
 * the per-prompt marker cap. It reads the part's private payload, which never
 * reaches the model text or a public share, and renders at the top of the
 * triggering user turn, live and reloaded alike.
 *
 * @summary owner chip for imported, truncated, denied, failed, and omitted prompt files
 */
export function PromptImportsPart(payload: PromptImportsPayload) {
  return (
    <div className="my-1 flex flex-wrap items-center gap-1">
      <Badge variant="outline">
        <AtSignIcon />
        Imports
      </Badge>
      {chipEntries(payload).map((entry) => (
        <PromptImportChip key={entry.key} entry={entry} />
      ))}
    </div>
  );
}
