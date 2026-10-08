"use client";

import { BanIcon, BookOpenIcon, FileTextIcon } from "lucide-react";

import { Badge } from "@workspace/ui/components/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

import type { InstructionsPayload } from "@/lib/services/chat/history";

/** How one file path figures in the bundle: loaded whole, loaded up to the
 *  per-file cap, or denied by the `read` permission group. */
type InstructionFileState = "loaded" | "truncated" | "denied";

/** The accessible name per state — the badge truncates the visible path, so
 *  the full selected path lives in the label and the tooltip. */
const STATE_LABEL: Record<InstructionFileState, string> = {
  loaded: "Loaded",
  truncated: "Truncated",
  denied: "Denied",
};

type InstructionFileChipEntry = {
  /** Unique within a bundle: a path is either loaded or denied, never both. */
  key: string;
  state: InstructionFileState;
  path: string;
  canonicalPath: string | null;
  importedBy: string | undefined;
};

/** Loaded files first in the api's directory order, then the denied paths —
 *  each entry renders as its own badge. */
function chipEntries(
  payload: InstructionsPayload,
): Array<InstructionFileChipEntry> {
  return [
    ...payload.files.map(
      (file): InstructionFileChipEntry => ({
        key: `file:${file.path}`,
        state: file.truncated ? "truncated" : "loaded",
        path: file.path,
        canonicalPath: file.canonicalPath,
        importedBy: file.importedBy,
      }),
    ),
    ...payload.denied.map(
      (path): InstructionFileChipEntry => ({
        key: `denied:${path}`,
        state: "denied",
        path,
        canonicalPath: null,
        importedBy: undefined,
      }),
    ),
  ];
}

type InstructionFileChipTreeNode = {
  entry: InstructionFileChipEntry;
  children: Array<InstructionFileChipTreeNode>;
};

/** Groups imported entries below the loaded file whose path they reference. */
function nestChipEntries(
  entries: ReadonlyArray<InstructionFileChipEntry>,
): Array<InstructionFileChipTreeNode> {
  const nodes: Array<InstructionFileChipTreeNode> = entries.map((entry) => ({
    entry,
    children: [],
  }));
  const nodesByPath = new Map(
    nodes.flatMap((node) =>
      node.entry.canonicalPath === null
        ? []
        : [[node.entry.path, node] as const],
    ),
  );
  const roots: Array<InstructionFileChipTreeNode> = [];

  for (const node of nodes) {
    const importer = node.entry.importedBy
      ? nodesByPath.get(node.entry.importedBy)
      : undefined;
    if (importer && importer !== node) {
      importer.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/** One file entry: its selected path, marked when truncated or denied. A
 *  denied path stays muted — the `secondary` surface, never the destructive
 *  variant — because the `read` group's rejection is a policy state, not an
 *  error the user must act on, and Alert Red is reserved for destructive
 *  states (DESIGN.md §10). */
function InstructionFileChip({ entry }: { entry: InstructionFileChipEntry }) {
  const denied = entry.state === "denied";
  const tooltip =
    entry.canonicalPath !== null && entry.canonicalPath !== entry.path
      ? `${entry.path} → ${entry.canonicalPath}`
      : entry.path;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant={denied ? "secondary" : "outline"}
            className="max-w-64"
            aria-label={`${STATE_LABEL[entry.state]} instruction file: ${entry.path}`}
            tabIndex={0}
          />
        }
      >
        {denied ? <BanIcon /> : <FileTextIcon />}
        <span className="truncate">{entry.path}</span>
        {entry.state !== "loaded" && (
          <span className="shrink-0">{entry.state}</span>
        )}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/** Renders an importer and its imported files as a nested layout group. */
function InstructionFileChipTree({
  node,
}: {
  node: InstructionFileChipTreeNode;
}) {
  if (node.children.length === 0) {
    return <InstructionFileChip entry={node.entry} />;
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <InstructionFileChip entry={node.entry} />
      <div className="flex flex-col items-start gap-1 pl-4">
        {node.children.map((child) => (
          <InstructionFileChipTree key={child.entry.key} node={child} />
        ))}
      </div>
    </div>
  );
}

/**
 * The owner-facing chip for an `instructions` context item (design D9): the
 * paths a trigger loaded, each marked when the file was cut at the per-file
 * cap or denied by the `read` permission group. It reads the part's private
 * payload, which never reaches the model text or a public share. The
 * transcript renders it where the item was stored — after the step that
 * loaded the files on an in-Run item, at the top of the triggering user turn
 * on an accepted-turn one — and live and reloaded history show the same
 * disclosure at the same spot.
 *
 * @summary owner chip for loaded, truncated, and denied instruction files
 */
export function InstructionsPart(payload: InstructionsPayload) {
  const roots = nestChipEntries(chipEntries(payload));

  return (
    <div className="my-1 flex flex-wrap items-center gap-1">
      <Badge variant="outline">
        <BookOpenIcon />
        Instructions
      </Badge>
      {roots.map((node) => (
        <InstructionFileChipTree key={node.entry.key} node={node} />
      ))}
    </div>
  );
}
