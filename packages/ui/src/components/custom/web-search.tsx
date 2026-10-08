"use client";

import type { ComponentType, ReactElement } from "react";
import { z } from "zod";

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolHeaderState,
} from "@workspace/ui/components/ai-elements/tool";

const markdownSpecialCharacterPattern = /([\\`*_[\]{}()#+\-.!|<>~$&])/gu;

/** The normalized result shape displayed by the web search renderer. */
const resultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string().optional(),
  published: z.string().optional(),
});

const citationSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
});

const outputBaseSchema = {
  status: z.literal("success"),
  engine: z.string(),
  query: z.string(),
  notes: z.array(z.string()).optional(),
};

const outputSchema = z.discriminatedUnion("kind", [
  z.object({
    ...outputBaseSchema,
    kind: z.literal("results"),
    results: z.array(resultSchema),
  }),
  z.object({
    ...outputBaseSchema,
    kind: z.literal("answer"),
    answer: z.string(),
    citations: z.array(citationSchema),
  }),
]);

type WebSearchResult = z.infer<typeof resultSchema>;
type WebSearchOutput = z.infer<typeof outputSchema>;
type WebSearchResultsOutput = Extract<WebSearchOutput, { kind: "results" }>;
type WebSearchAnswerOutput = Extract<WebSearchOutput, { kind: "answer" }>;

/** Props for the dedicated web search tool row. */
export type WebSearchToolProps = {
  /** Tool arguments shown in the shared Parameters panel. */
  input: unknown;
  /** Normalized search output; malformed values fall back to generic JSON. */
  output: unknown;
  /** Error returned by the tool, if the invocation failed. */
  errorText: string | undefined;
  /** Current lifecycle state, including llame's cancellation state. */
  state: ToolHeaderState;
  /** Markdown renderer supplied by the chat so generated links use link safety. */
  Markdown: ComponentType<{ children?: string }>;
};

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function escapeMarkdown(value: string): string {
  return value
    .replaceAll(/[\r\n]+/gu, " ")
    .replaceAll(markdownSpecialCharacterPattern, String.raw`\$1`);
}

function escapeMarkdownUrl(value: string): string {
  return value.replaceAll("\\", "%5C").replaceAll("&", String.raw`\&`);
}

function SearchLink({
  label,
  url,
  Markdown,
}: {
  label: string;
  url: string;
  Markdown: ComponentType<{ children?: string }>;
}) {
  const parsedUrl = parseHttpUrl(url);
  if (!parsedUrl) return <span>{label}</span>;

  return (
    <Markdown>
      {`[${escapeMarkdown(label)}](<${escapeMarkdownUrl(parsedUrl.href)}>)`}
    </Markdown>
  );
}

function SearchMetadata({
  engine,
  notes,
}: {
  engine: string;
  notes: ReadonlyArray<string> | undefined;
}) {
  return (
    <div className="border-border border-t px-4 py-3 text-muted-foreground text-xs">
      <p>
        <span className="font-medium">Engine:</span> {engine}
      </p>
      {notes && notes.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {notes.map((note, index) => (
            <li key={`${note}-${index}`}>
              <span className="font-medium">Note:</span> {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultItem({
  result,
  Markdown,
}: {
  result: WebSearchResult;
  Markdown: ComponentType<{ children?: string }>;
}) {
  const parsedUrl = parseHttpUrl(result.url);
  const host = parsedUrl?.host;
  const hasMetadata =
    host !== undefined ||
    result.published !== undefined ||
    result.snippet !== undefined;

  return (
    <li className="pl-1">
      <SearchLink label={result.title} url={result.url} Markdown={Markdown} />
      {hasMetadata && (
        <p className="mt-1 text-muted-foreground text-xs">
          {host}
          {result.published && <> · {result.published}</>}
          {result.snippet && <> · {result.snippet}</>}
        </p>
      )}
    </li>
  );
}

function ResultsBody({
  output,
  Markdown,
}: {
  output: WebSearchResultsOutput;
  Markdown: ComponentType<{ children?: string }>;
}) {
  return (
    <div className="space-y-4">
      {output.results.length === 0 ? (
        <p className="px-4 pt-4 text-muted-foreground text-sm">
          No results found.
        </p>
      ) : (
        <ol className="list-decimal space-y-4 px-8 pt-4">
          {output.results.map((result, index) => (
            <ResultItem
              key={`${result.url}-${index}`}
              result={result}
              Markdown={Markdown}
            />
          ))}
        </ol>
      )}
      <SearchMetadata engine={output.engine} notes={output.notes} />
    </div>
  );
}

function AnswerBody({
  output,
  Markdown,
}: {
  output: WebSearchAnswerOutput;
  Markdown: ComponentType<{ children?: string }>;
}) {
  return (
    <div className="space-y-4">
      <div className="px-4 pt-4">
        <Markdown>{output.answer}</Markdown>
      </div>
      {output.citations.length > 0 && (
        <ol className="list-decimal space-y-2 px-8">
          {output.citations.map((citation, index) => (
            <li className="pl-1" key={`${citation.url}-${index}`}>
              <SearchLink
                label={citation.title ?? citation.url}
                url={citation.url}
                Markdown={Markdown}
              />
            </li>
          ))}
        </ol>
      )}
      <SearchMetadata engine={output.engine} notes={output.notes} />
    </div>
  );
}

/**
 * Renders a web search tool invocation with safe Markdown links, normalized
 * result/answer content, and the shared tool lifecycle chrome.
 *
 * @summary displays web search results and answers inside a collapsible tool row
 */
export function WebSearchTool({
  input,
  output,
  errorText,
  state,
  Markdown,
}: WebSearchToolProps): ReactElement {
  const validOutput = outputSchema.safeParse(output).data;

  return (
    <Tool>
      <ToolHeader state={state} type="tool-web_search" />
      <ToolContent>
        <ToolInput input={input} />
        {state === "cancelled" ? null : errorText ? (
          <ToolOutput
            errorText={errorText}
            output={undefined}
            state="output-error"
          />
        ) : validOutput ? (
          validOutput.kind === "results" ? (
            <ResultsBody output={validOutput} Markdown={Markdown} />
          ) : (
            <AnswerBody output={validOutput} Markdown={Markdown} />
          )
        ) : output !== undefined ? (
          <ToolOutput output={output} errorText={undefined} />
        ) : (
          <p className="p-4 text-muted-foreground text-sm">Searching…</p>
        )}
      </ToolContent>
    </Tool>
  );
}
