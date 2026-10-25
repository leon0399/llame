"use client";

import type { ReactElement } from "react";
import { z } from "zod";

import {
  ToolDetails,
  type ToolPartProps,
  ToolResultFallback,
  ToolRow,
  ToolSection,
} from "@workspace/ui/components/custom/tool-row";

const inputSchema = z.object({ query: z.string() });

const resultSchema = z.object({
  knowledgeSpaceId: z.string(),
  knowledgeSpaceName: z.string(),
  path: z.string(),
  locator: z.string(),
  excerpt: z.string(),
});

/** Loose: the runner's oversize cap may add `truncated`/`truncationNotice`. */
const outputSchema = z.looseObject({
  status: z.literal("success"),
  results: z.array(resultSchema),
  notice: z.string(),
  nextCursor: z.string().optional(),
  warnings: z.array(
    z.object({
      knowledgeSpaceId: z.string(),
      knowledgeSpaceName: z.string(),
      message: z.string(),
    }),
  ),
  truncationNotice: z.string().optional(),
});

type KnowledgeSearchOutput = z.infer<typeof outputSchema>;
type KnowledgeResult = z.infer<typeof resultSchema>;

/** Props for the dedicated `knowledge_search` tool row. */
export type KnowledgeSearchToolProps = ToolPartProps;

// A passage locator ends in its 1-based inclusive line range.
const locatorRangePattern = /:(\d+)-(\d+)$/u;

/** One passage: its path and lines, then the attribution knowledge-tools
 *  requires the UI to show (space name, stable id, and the exact `read`
 *  locator), so two spaces with one name stay distinguishable. */
function KnowledgePassage({ result }: { result: KnowledgeResult }) {
  const range = locatorRangePattern.exec(result.locator);
  return (
    <li className="space-y-1">
      <p className="text-xs">
        <span className="break-all font-medium font-mono">{result.path}</span>
        {range ? (
          <span className="text-muted-foreground">
            {" "}
            ·{" "}
            {range[1] === range[2]
              ? `line ${range[1]}`
              : `lines ${range[1]}–${range[2]}`}
          </span>
        ) : null}
      </p>
      <p className="break-all text-muted-foreground text-xs">
        {result.knowledgeSpaceName} ·{" "}
        <span className="font-mono">{result.knowledgeSpaceId}</span>
      </p>
      <p className="break-all font-mono text-muted-foreground text-xs">
        {result.locator}
      </p>
      <p className="whitespace-pre-wrap break-words rounded-md bg-muted/50 px-3 py-2 font-mono text-xs">
        {result.excerpt}
      </p>
    </li>
  );
}

/** Continuation, per-space warnings, and notices. */
function knowledgeDetailRows(
  output: KnowledgeSearchOutput,
): Array<readonly [string, string | undefined]> {
  return [
    [
      "More results",
      output.nextCursor === undefined
        ? undefined
        : "available on the next page",
    ],
    ...output.warnings.map(
      ({ knowledgeSpaceId, knowledgeSpaceName, message }): [string, string] => [
        "Warning",
        `${knowledgeSpaceName} (${knowledgeSpaceId}): ${message}`,
      ],
    ),
    ["Note", output.truncationNotice],
    ["Notice", output.notice],
  ];
}

function KnowledgeResults({ output }: { output: KnowledgeSearchOutput }) {
  const count = output.results.length;
  return (
    <>
      <ToolSection
        label="Knowledge"
        aside={
          count === 0
            ? undefined
            : `${count} ${count === 1 ? "passage" : "passages"}`
        }
      >
        {count === 0 ? (
          <p className="text-muted-foreground text-sm">No matches.</p>
        ) : (
          <ul className="space-y-3">
            {output.results.map((result) => (
              <KnowledgePassage key={result.locator} result={result} />
            ))}
          </ul>
        )}
      </ToolSection>
      <ToolDetails rows={knowledgeDetailRows(output)} />
    </>
  );
}

/**
 * Renders a `knowledge_search` invocation: matching passages from the
 * owner's Knowledge Spaces, each with its space, file, line range, and
 * excerpt, plus any space that could not be searched.
 *
 * @summary displays a Knowledge search inside a collapsible tool row
 */
export function KnowledgeSearchTool({
  input,
  output,
  errorText,
  state,
}: KnowledgeSearchToolProps): ReactElement {
  const result = outputSchema.safeParse(output).data;
  return (
    <ToolRow
      name="knowledge_search"
      summary={inputSchema.safeParse(input).data?.query}
      input={input}
      errorText={errorText}
      state={state}
    >
      {result ? (
        <KnowledgeResults output={result} />
      ) : (
        <ToolResultFallback output={output} pendingLabel="Searching…" />
      )}
    </ToolRow>
  );
}
