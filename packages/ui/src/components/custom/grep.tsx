"use client";

import type { ReactElement } from "react";
import { z } from "zod";

import {
  languageForPath,
  parseNumberedLines,
  type SourceLine,
  SourceLines,
} from "@workspace/ui/components/custom/source-lines";
import {
  type RankRecord,
  rankDisplaySchema,
  rankRecordOf,
  rankScoreAt,
  ToolDetails,
  type ToolPartProps,
  ToolRankBadge,
  ToolRankScore,
  ToolResultFallback,
  ToolRow,
  ToolSection,
} from "@workspace/ui/components/custom/tool-row";

const inputSchema = z.object({
  patterns: z.array(z.string()),
  scopes: z.array(z.string()).optional(),
  literal: z.boolean().optional(),
  ignoreCase: z.boolean().optional(),
  objective: z.string().optional(),
});

const passageSchema = z.object({
  locator: z.string(),
  content: z.string(),
  matches: z.array(z.number()),
  /**
   * An internal page bound cut the passage. The tool joins it with its
   * continuation unless the walk stopped first.
   */
  cut: z.boolean().optional(),
  /** The passage is its file's twentieth, so the page shows no more of it. */
  truncated: z.boolean().optional(),
});

/** Loose: the runner's oversize cap may add `truncated`/`truncationNotice`. */
const outputSchema = z.looseObject({
  status: z.literal("success"),
  results: z.array(passageSchema),
  complete: z.boolean(),
  warnings: z.array(z.object({ kind: z.string(), count: z.number() })),
  /** `"unavailable"`: the rank call failed and the walk order stands. */
  ranking: z.string().optional(),
  /** A ranked call stores `display.rerank`; `runLengths` aligns with `order`. */
  display: rankDisplaySchema.optional(),
  notice: z.string().optional(),
  truncationNotice: z.string().optional(),
});

type GrepInput = z.infer<typeof inputSchema>;
type GrepOutput = z.infer<typeof outputSchema>;
type GrepPassage = GrepOutput["results"][number];

/** Props for the dedicated `grep` tool row. */
export type GrepToolProps = ToolPartProps;

/** One run: consecutive passages of one file, shown as one numbered view. */
type FileRun = {
  path: string;
  lines: Array<SourceLine>;
  matches: Set<number>;
};

const warningLabels = new Map([
  ["binary", "binary files skipped"],
  ["invalid_utf8", "non-UTF-8 files skipped"],
  ["oversized", "oversized files skipped"],
  ["unreadable", "unreadable entries skipped"],
  ["link", "links not followed"],
  ["file_bound", "file limit reached"],
  ["entry_bound", "entry limit reached"],
  ["byte_bound", "byte limit reached"],
  ["deadline", "search deadline reached"],
]);

type LocatorParts = { path: string; start: number };

/** The `<path>` and start line of a `<path>:<start>-<end>` passage locator.
 *  The path may itself contain `:`, so only the last one separates the range. */
function locatorParts(locator: string): LocatorParts {
  const separator = locator.lastIndexOf(":");
  if (separator === -1) return { path: locator, start: 0 };
  return {
    path: locator.slice(0, separator),
    start: Number.parseInt(locator.slice(separator + 1), 10) || 0,
  };
}

/** The passages as runs in result order. Explicit `runLengths` mark each run's
 *  passages, so same-file runs a reorder placed side by side stay separate; the
 *  last run may hold fewer passages than its length when the inline part cut
 *  it. Passages past the lengths, or without them, continue a run only while
 *  the file stays the same and the start line rises. */
function groupRuns(output: GrepOutput): Array<FileRun> {
  const runs: Array<FileRun> = [];
  const add = (run: FileRun | undefined, passage: GrepPassage): FileRun => {
    const target = run ?? {
      path: locatorParts(passage.locator).path,
      lines: [],
      matches: new Set<number>(),
    };
    target.lines.push(...parseNumberedLines(passage.content));
    for (const line of passage.matches) target.matches.add(line);
    return target;
  };
  let index = 0;
  for (const length of output.display?.rerank?.runLengths ?? []) {
    if (index >= output.results.length) break;
    let run: FileRun | undefined;
    for (const passage of output.results.slice(index, index + length))
      run = add(run, passage);
    if (run) runs.push(run);
    index += length;
  }
  let previous: LocatorParts | undefined;
  let run: FileRun | undefined;
  for (const passage of output.results.slice(index)) {
    const parts = locatorParts(passage.locator);
    if (run && previous?.path === parts.path && parts.start > previous.start) {
      run = add(run, passage);
    } else {
      if (run) runs.push(run);
      run = add(undefined, passage);
    }
    previous = parts;
  }
  if (run) runs.push(run);
  return runs;
}

function GrepQuery({ input }: { input: GrepInput }) {
  const modes = [
    input.literal ? "literal" : "regex",
    input.ignoreCase ? "ignore case" : undefined,
  ].filter(Boolean);
  return (
    <ToolSection label="Search" aside={modes.join(" · ")}>
      <ul className="space-y-1 font-mono text-xs">
        {input.patterns.map((pattern) => (
          <li
            className="break-all rounded-md bg-muted/50 px-3 py-1.5"
            key={pattern}
          >
            {pattern}
          </li>
        ))}
      </ul>
      {input.objective ? (
        <p className="break-words text-xs">
          <span className="font-medium">Objective:</span> {input.objective}
        </p>
      ) : null}
      <p className="break-all text-muted-foreground text-xs">
        in {input.scopes?.join(", ") ?? "the Workspace"}
      </p>
    </ToolSection>
  );
}

function GrepFile({
  file,
  rank,
}: {
  file: FileRun;
  rank: RunRank | undefined;
}) {
  return (
    <li className="space-y-1">
      <p className="flex items-baseline justify-between gap-4 text-xs">
        <span className="break-all font-medium font-mono">{file.path}</span>
        <span className="flex shrink-0 items-baseline gap-2 text-muted-foreground">
          {rank ? (
            <ToolRankScore
              ordinal={rank.ordinal}
              itemKey={rank.key}
              score={rank.score}
            />
          ) : null}
          {file.matches.size} {file.matches.size === 1 ? "match" : "matches"}
        </span>
      </p>
      <SourceLines
        lines={file.lines}
        label={`Matches in ${file.path}`}
        language={languageForPath(file.path)}
        emphasized={file.matches}
      />
    </li>
  );
}

/** The page's completeness, skipped-entry warnings, and notices. */
function grepDetailRows(
  output: GrepOutput,
): Array<readonly [string, string | undefined]> {
  return [
    [
      "More results",
      output.complete ? undefined : "available on the next page",
    ],
    ...output.warnings.map(({ kind, count }): [string, string] => [
      "Warning",
      `${warningLabels.get(kind) ?? kind} (${count})`,
    ]),
    [
      "Ranking",
      output.ranking === "unavailable"
        ? "[ranking unavailable; walk order]"
        : undefined,
    ],
    [
      "Truncated",
      output.results.some((passage) => passage.cut)
        ? "a passage was cut at a page bound"
        : undefined,
    ],
    ["Note", output.truncationNotice],
    ["Notice", output.notice],
  ];
}

type RunRank = { key: string; score: number; ordinal: number };

/** The score of the run at `index` of the applied order, with its ordinal. */
function runRank(
  record: RankRecord | undefined,
  index: number,
): RunRank | undefined {
  const scored = rankScoreAt(record, index);
  return scored && { ...scored, ordinal: index + 1 };
}

function GrepResult({ output }: { output: GrepOutput }) {
  const runs = groupRuns(output);
  const record = rankRecordOf(output.display);
  const fileCount = new Set(runs.map((run) => run.path)).size;
  const matchCount = runs.reduce((sum, run) => sum + run.matches.size, 0);
  return (
    <>
      {record ? (
        <div className="px-4 pt-3">
          <ToolRankBadge record={record} />
        </div>
      ) : null}
      <ToolSection
        label="Matches"
        aside={
          runs.length === 0
            ? undefined
            : `${matchCount} in ${fileCount} ${fileCount === 1 ? "file" : "files"}`
        }
      >
        {runs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No matches.</p>
        ) : (
          <ul className="space-y-3">
            {runs.map((run, index) => (
              <GrepFile
                file={run}
                key={`${run.path}-${index}`}
                rank={runRank(record, index)}
              />
            ))}
          </ul>
        )}
      </ToolSection>
      <ToolDetails rows={grepDetailRows(output)} />
    </>
  );
}

/**
 * Renders a native `grep` invocation: the patterns and where they were
 * searched, then the matching passages grouped by file with their real line
 * numbers, the matching lines emphasized, and context lines around them.
 *
 * @summary displays a code search and its matches inside a collapsible tool row
 */
export function GrepTool({
  input,
  output,
  errorText,
  state,
}: GrepToolProps): ReactElement {
  const query = inputSchema.safeParse(input).data;
  const result = outputSchema.safeParse(output).data;
  return (
    <ToolRow
      name="grep"
      summary={query?.patterns.join(" | ")}
      input={input}
      errorText={errorText}
      state={state}
      showInput={query === undefined}
      preview={query ? <GrepQuery input={query} /> : null}
    >
      {result ? (
        <GrepResult output={result} />
      ) : (
        <ToolResultFallback output={output} pendingLabel="Searching…" />
      )}
    </ToolRow>
  );
}
