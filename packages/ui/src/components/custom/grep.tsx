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
  ToolDetails,
  type ToolPartProps,
  ToolResultFallback,
  ToolRow,
  ToolSection,
} from "@workspace/ui/components/custom/tool-row";

const inputSchema = z.object({
  patterns: z.array(z.string()),
  scopes: z.array(z.string()).optional(),
  literal: z.boolean().optional(),
  ignoreCase: z.boolean().optional(),
});

const passageSchema = z.object({
  locator: z.string(),
  content: z.string(),
  matches: z.array(z.number()),
  truncated: z.boolean().optional(),
});

/** Loose: the runner's oversize cap may add `truncated`/`truncationNotice`. */
const outputSchema = z.looseObject({
  status: z.literal("success"),
  results: z.array(passageSchema),
  complete: z.boolean(),
  warnings: z.array(z.object({ kind: z.string(), count: z.number() })),
  notice: z.string().optional(),
  truncationNotice: z.string().optional(),
});

type GrepInput = z.infer<typeof inputSchema>;
type GrepOutput = z.infer<typeof outputSchema>;

/** Props for the dedicated `grep` tool row. */
export type GrepToolProps = ToolPartProps;

type FileMatches = {
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

/** The file part of a `<path>:<start>-<end>` passage locator. The path may
 *  itself contain `:`, so only the last one separates the range. */
function locatorPath(locator: string): string {
  const separator = locator.lastIndexOf(":");
  return separator === -1 ? locator : locator.slice(0, separator);
}

/** Passages grouped by file in result order; a file's passages share one
 *  numbered view, where a gap marker separates non-adjacent passages. */
function groupByFile(output: GrepOutput): Array<FileMatches> {
  const files = new Map<string, FileMatches>();
  for (const passage of output.results) {
    const path = locatorPath(passage.locator);
    const file = files.get(path) ?? { path, lines: [], matches: new Set() };
    file.lines.push(...parseNumberedLines(passage.content));
    for (const line of passage.matches) file.matches.add(line);
    files.set(path, file);
  }
  return [...files.values()];
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
      <p className="break-all text-muted-foreground text-xs">
        in {input.scopes?.join(", ") ?? "the Workspace"}
      </p>
    </ToolSection>
  );
}

function GrepFile({ file }: { file: FileMatches }) {
  return (
    <li className="space-y-1">
      <p className="flex items-baseline justify-between gap-4 text-xs">
        <span className="break-all font-medium font-mono">{file.path}</span>
        <span className="shrink-0 text-muted-foreground">
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
      "Truncated",
      output.results.some((passage) => passage.truncated)
        ? "a passage was cut to fit the page"
        : undefined,
    ],
    ["Note", output.truncationNotice],
    ["Notice", output.notice],
  ];
}

function GrepResult({ output }: { output: GrepOutput }) {
  const files = groupByFile(output);
  const matchCount = files.reduce((sum, file) => sum + file.matches.size, 0);
  return (
    <>
      <ToolSection
        label="Matches"
        aside={
          files.length === 0
            ? undefined
            : `${matchCount} in ${files.length} ${files.length === 1 ? "file" : "files"}`
        }
      >
        {files.length === 0 ? (
          <p className="text-muted-foreground text-sm">No matches.</p>
        ) : (
          <ul className="space-y-3">
            {files.map((file) => (
              <GrepFile file={file} key={file.path} />
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
