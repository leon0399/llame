"use client";

import { BookOpenIcon } from "lucide-react";

import type { InstructionsPayload } from "@/lib/services/chat/history";

import { ContextChipGroup, ContextFileChip } from "./context-file-chip";

/** How one file path figures in the bundle: loaded whole, loaded up to the
 *  per-file cap, or denied by the `read` permission group. */
type InstructionFileState = "loaded" | "truncated" | "denied";

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

type InstructionFileChipRenderEntry = {
  entry: InstructionFileChipEntry;
  depth: number;
};

/** Computes each file's indentation without changing the payload order. */
function chipEntryDepths(
  entries: ReadonlyArray<InstructionFileChipEntry>,
): Array<InstructionFileChipRenderEntry> {
  const entriesByPath = new Map(
    entries.flatMap((entry) =>
      entry.canonicalPath === null ? [] : [[entry.path, entry] as const],
    ),
  );
  const depths = new Map<InstructionFileChipEntry, number>();

  const depthOf = (
    entry: InstructionFileChipEntry,
    ancestors: Set<InstructionFileChipEntry>,
  ): number => {
    const cached = depths.get(entry);
    if (cached !== undefined) return cached;
    if (ancestors.has(entry)) return 0;

    const importer =
      entry.importedBy === undefined
        ? undefined
        : entriesByPath.get(entry.importedBy);
    if (importer === undefined || importer === entry) {
      depths.set(entry, 0);
      return 0;
    }

    ancestors.add(entry);
    const depth = depthOf(importer, ancestors) + 1;
    ancestors.delete(entry);
    depths.set(entry, depth);
    return depth;
  };

  return entries.map((entry) => ({
    entry,
    depth: depthOf(entry, new Set<InstructionFileChipEntry>()),
  }));
}

/** Import depth is bounded by the 5-hop limit, so a fixed class table covers it. */
const DEPTH_INDENT = ["", "ps-4", "ps-8", "ps-12", "ps-16", "ps-20"];

/** Renders one chip with indentation derived from its import ancestry. */
function InstructionFileChipRow({
  entry,
  depth,
}: {
  entry: InstructionFileChipEntry;
  depth: number;
}) {
  const indent = DEPTH_INDENT[Math.min(depth, DEPTH_INDENT.length - 1)];
  const detail =
    entry.canonicalPath !== null && entry.canonicalPath !== entry.path
      ? `${entry.path} → ${entry.canonicalPath}`
      : undefined;

  return (
    <div className={`flex items-center gap-1 ${indent}`}>
      <ContextFileChip
        kind="instruction"
        path={entry.path}
        detail={detail}
        state={entry.state}
        muted={entry.state === "denied"}
      />
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
  const entries = chipEntryDepths(chipEntries(payload));

  return (
    <ContextChipGroup icon={<BookOpenIcon />} label="Instructions">
      {entries.map(({ entry, depth }) => (
        <InstructionFileChipRow key={entry.key} entry={entry} depth={depth} />
      ))}
    </ContextChipGroup>
  );
}
