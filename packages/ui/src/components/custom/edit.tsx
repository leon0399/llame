"use client";

import { type ChangeObject, diffLines, diffWordsWithSpace } from "diff";
import type { CSSProperties, ReactElement } from "react";
import { z } from "zod";

import { ScrollRegion } from "@workspace/ui/components/custom/scroll-region";
import {
  ToolDetails,
  type ToolPartProps,
  ToolResultFallback,
  ToolRow,
  ToolSection,
} from "@workspace/ui/components/custom/tool-row";
import { cn } from "@workspace/ui/lib/utils";

const inputSchema = z.object({
  path: z.string(),
  oldText: z.string(),
  newText: z.string(),
});

/** Loose: the runner's oversize cap may add `truncationNotice`. */
const outputSchema = z.looseObject({
  status: z.literal("success"),
  path: z.string(),
  diff: z.string(),
  truncated: z.boolean(),
  truncationNotice: z.string().optional(),
});

type EditOutput = z.infer<typeof outputSchema>;

/** Props for the dedicated `edit` tool row. */
export type EditToolProps = ToolPartProps;

type Segment = { text: string; changed: boolean };

type DiffRow = {
  kind: "context" | "removed" | "added";
  oldNumber: number | null;
  newNumber: number | null;
  segments: Array<Segment>;
};

// The edit result's replacement header names the first replaced line.
const replacementHeaderPattern = /^@@ replacement at line (\d+) @@/u;

function changeLines(change: ChangeObject<string>): Array<string> {
  const value = change.value.endsWith("\n")
    ? change.value.slice(0, -1)
    : change.value;
  return value.split("\n");
}

/** Word-level segments of one side of a replaced line pair. */
function wordSegments(
  before: string,
  after: string,
  side: "removed" | "added",
): Array<Segment> {
  return diffWordsWithSpace(before, after)
    .filter((part) => (side === "removed" ? !part.added : !part.removed))
    .map((part) => ({
      text: part.value,
      changed: side === "removed" ? part.removed : part.added,
    }));
}

/** The line `index` lines after `start`, or `null` when unnumbered. */
function lineNumber(start: number | null, index: number): number | null {
  return start === null ? null : start + index;
}

function contextRows(
  lines: Array<string>,
  numbers: { old: number | null; new: number | null },
): Array<DiffRow> {
  return lines.map((text, index) => ({
    kind: "context",
    oldNumber: lineNumber(numbers.old, index),
    newNumber: lineNumber(numbers.new, index),
    segments: [{ text, changed: false }],
  }));
}

/** The rows of a removed run and the added run that replaces it. Runs of
 *  equal length pair line by line, so each pair marks its changed words. */
function replacementRows(
  removed: Array<string>,
  added: Array<string>,
  numbers: { old: number | null; new: number | null },
): Array<DiffRow> {
  const paired = removed.length === added.length;
  return [
    ...removed.map(
      (text, index): DiffRow => ({
        kind: "removed",
        oldNumber: lineNumber(numbers.old, index),
        newNumber: null,
        segments: paired
          ? wordSegments(text, added[index] ?? "", "removed")
          : [{ text, changed: false }],
      }),
    ),
    ...added.map(
      (text, index): DiffRow => ({
        kind: "added",
        oldNumber: null,
        newNumber: lineNumber(numbers.new, index),
        segments: paired
          ? wordSegments(removed[index] ?? "", text, "added")
          : [{ text, changed: false }],
      }),
    ),
  ];
}

/**
 * A line diff of `oldText` against `newText` with unchanged lines as
 * context, numbered from `start` on both sides when the result named it.
 */
function diffRows(
  oldText: string,
  newText: string,
  start: number | null,
): Array<DiffRow> {
  const changes = diffLines(oldText, newText, { ignoreNewlineAtEof: true });
  const rows: Array<DiffRow> = [];
  const numbers = { old: start, new: start };
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    if (change === undefined) continue;
    const lines = changeLines(change);
    const next = changes[index + 1];
    // A removal followed by an addition is one replacement.
    const replacedBy = change.removed && next?.added ? next : undefined;
    if (replacedBy) index += 1;
    const block =
      change.added || change.removed
        ? replacementRows(
            change.removed ? lines : [],
            replacedBy ? changeLines(replacedBy) : change.added ? lines : [],
            numbers,
          )
        : contextRows(lines, numbers);
    rows.push(...block);
    numbers.old = lineNumber(
      numbers.old,
      block.filter((row) => row.kind !== "added").length,
    );
    numbers.new = lineNumber(
      numbers.new,
      block.filter((row) => row.kind !== "removed").length,
    );
  }
  return rows;
}

const markers = { context: " ", removed: "−", added: "+" } as const;

/** A row's text, its changed words on a stronger fill of the row's tint. */
function DiffText({ row }: { row: DiffRow }) {
  return (
    <span className="min-h-[1lh] min-w-0 flex-1 whitespace-pre-wrap break-words pr-3">
      {row.segments.map((segment, index) => (
        <span
          // Segments have no identity beyond their position.
          key={index}
          className={cn(
            segment.changed &&
              (row.kind === "removed"
                ? "rounded-sm bg-destructive/20 dark:bg-destructive/50"
                : "rounded-sm bg-foreground/15 dark:bg-foreground/20"),
          )}
        >
          {segment.text}
        </span>
      ))}
    </span>
  );
}

function DiffLine({ row }: { row: DiffRow }) {
  // Slate fails contrast on the tinted rows, so their gutters use a darker
  // ink and their markers full ink.
  const tinted = row.kind !== "context";
  const gutter = cn(
    "w-(--gutter) shrink-0 select-none pl-3 text-right tabular-nums",
    tinted ? "text-foreground/70" : "text-muted-foreground",
  );
  return (
    <div
      className={cn(
        "flex",
        row.kind === "removed" && "bg-destructive/10 dark:bg-destructive/20",
        row.kind === "added" && "bg-foreground/5 dark:bg-foreground/10",
      )}
    >
      <span aria-hidden="true" className={gutter}>
        {row.oldNumber}
      </span>
      <span aria-hidden="true" className={gutter}>
        {row.newNumber}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "w-6 shrink-0 select-none text-center",
          tinted ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {markers[row.kind]}
      </span>
      <DiffText row={row} />
    </div>
  );
}

/**
 * A replacement as a unified diff: old and new line numbers, a `−`/`+`
 * marker, a tinted row for each removed or added line, and the changed words
 * within a replaced line emphasized. The markers carry the meaning, so it
 * never rests on the tint alone.
 */
function DiffView({ rows }: { rows: ReadonlyArray<DiffRow> }) {
  const gutterWidth = Math.max(
    1,
    ...rows.map((row) =>
      Math.max(
        String(row.oldNumber ?? "").length,
        String(row.newNumber ?? "").length,
      ),
    ),
  );
  return (
    <ScrollRegion label="Diff" className="rounded-md bg-muted/50">
      <div
        className="py-2 font-mono text-xs"
        // SAFETY: `--gutter` is a CSS custom property the gutters'
        // `w-(--gutter)` class reads; CSSProperties's type doesn't model it.
        style={{ "--gutter": `${gutterWidth + 2}ch` } as CSSProperties}
      >
        {rows.map((row, index) => (
          // Rows have no identity beyond their position.
          <DiffLine key={index} row={row} />
        ))}
      </div>
    </ScrollRegion>
  );
}

function EditDiff({
  oldText,
  newText,
  output,
}: {
  oldText: string;
  newText: string;
  output: EditOutput | undefined;
}) {
  const header = replacementHeaderPattern.exec(output?.diff ?? "");
  const rows = diffRows(oldText, newText, header ? Number(header[1]) : null);
  const removed = rows.filter((row) => row.kind === "removed").length;
  const added = rows.filter((row) => row.kind === "added").length;
  return (
    <ToolSection label="Diff" aside={`+${added} −${removed}`}>
      {oldText === newText ? (
        <p className="text-muted-foreground text-sm">No changes.</p>
      ) : (
        <DiffView rows={rows} />
      )}
    </ToolSection>
  );
}

/** The facts the diff omits. The result's numbered region repeats the
 *  diff's added lines, so it is not shown again. */
function EditResult({ output }: { output: EditOutput }) {
  return (
    <ToolDetails
      rows={[
        ["Truncated", output.truncated ? "yes" : undefined],
        ["Note", output.truncationNotice],
      ]}
    />
  );
}

/**
 * Renders a native `edit` invocation as a diff computed from the submitted
 * old and new text, numbered from the line the result names. The diff shows
 * while the edit runs and after a failure, so the attempted change stays
 * reviewable.
 *
 * @summary displays a file edit as a diff inside a collapsible tool row
 */
export function EditTool({
  input,
  output,
  errorText,
  state,
}: EditToolProps): ReactElement {
  const edit = inputSchema.safeParse(input).data;
  const result = outputSchema.safeParse(output).data;
  return (
    <ToolRow
      name="edit"
      summary={edit?.path}
      input={input}
      errorText={errorText}
      state={state}
      showInput={edit === undefined}
      preview={
        edit ? (
          <EditDiff
            oldText={edit.oldText}
            newText={edit.newText}
            output={result}
          />
        ) : null
      }
    >
      {result ? (
        <EditResult output={result} />
      ) : (
        <ToolResultFallback output={output} />
      )}
    </ToolRow>
  );
}
