"use client";

import type { ComponentType, ReactElement } from "react";
import { z } from "zod";

import type { ToolHeaderState } from "@workspace/ui/components/ai-elements/tool";
import { cn } from "@workspace/ui/lib/utils";
import {
  ToolResultFallback,
  ToolRow,
} from "@workspace/ui/components/custom/tool-row";

const markdownSpecialCharacterPattern = /[\\`*_[\]{}()#+\-.!|<>~$&]/gu;

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

const answerSchema = z.object({
  engine: z.string(),
  answer: z.string(),
  citations: z.array(citationSchema),
});

const outputSchema = z.discriminatedUnion("kind", [
  z.object({
    ...outputBaseSchema,
    kind: z.literal("results"),
    results: z.array(resultSchema),
    answers: z.array(answerSchema).optional(),
  }),
  z.object({
    ...outputBaseSchema,
    kind: z.literal("answer"),
    answer: z.string(),
    citations: z.array(citationSchema),
  }),
]);

type WebSearchResult = z.infer<typeof resultSchema>;
type Citation = z.infer<typeof citationSchema>;
type WebSearchAnswer = z.infer<typeof answerSchema>;
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

/**
 * Link labels use numeric character references because backslash escapes such
 * as `\(` and `\[` are read as LaTeX delimiters by the chat math preset.
 */
function escapeMarkdown(value: string): string {
  return value
    .replaceAll(/[\r\n]+/gu, " ")
    .replaceAll(
      markdownSpecialCharacterPattern,
      (character) => `&#${character.codePointAt(0)};`,
    );
}

function escapeMarkdownUrl(value: string): string {
  return value.replaceAll("\\", "%5C").replaceAll("&", String.raw`\&`);
}

/** An http(s) URL as an escaped Markdown link through the chat renderer, so
 *  link safety applies; any other URL stays plain text. */
export function SearchLink({
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
  const metadata = [
    parseHttpUrl(result.url)?.host,
    result.published?.slice(0, 10),
    result.snippet,
  ].filter(Boolean);

  return (
    <li className="pl-1">
      <SearchLink
        label={result.title || result.url}
        url={result.url}
        Markdown={Markdown}
      />
      {metadata.length > 0 && (
        <p className="mt-1 text-muted-foreground text-xs">
          {metadata.join(" · ")}
        </p>
      )}
    </li>
  );
}

/** The numbered citations of an answer, every link through `SearchLink`. */
function CitationList({
  citations,
  className,
  Markdown,
}: {
  citations: ReadonlyArray<Citation>;
  className: string;
  Markdown: ComponentType<{ children?: string }>;
}) {
  if (citations.length === 0) return null;
  return (
    <ol className={cn("list-decimal space-y-2", className)}>
      {citations.map((citation, index) => (
        <li className="pl-1" key={`${citation.url}-${index}`}>
          <SearchLink
            label={citation.title ?? citation.url}
            url={citation.url}
            Markdown={Markdown}
          />
        </li>
      ))}
    </ol>
  );
}

/** Attached answers render after the results, one block per answer engine. */
function AttachedAnswers({
  answers,
  Markdown,
}: {
  answers: ReadonlyArray<WebSearchAnswer>;
  Markdown: ComponentType<{ children?: string }>;
}) {
  return answers.map((entry, index) => (
    <section
      className="space-y-2 border-border border-t px-4 pt-4"
      key={`${entry.engine}-${index}`}
    >
      <p className="text-muted-foreground text-xs">
        <span className="font-medium">Engine:</span> {entry.engine}
      </p>
      <div className="text-sm">
        <Markdown>{entry.answer}</Markdown>
      </div>
      <CitationList
        citations={entry.citations}
        className="px-4"
        Markdown={Markdown}
      />
    </section>
  ));
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
      {output.answers !== undefined && output.answers.length > 0 && (
        <AttachedAnswers answers={output.answers} Markdown={Markdown} />
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
      <CitationList
        citations={output.citations}
        className="px-8"
        Markdown={Markdown}
      />
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
  let result: ReactElement;
  if (validOutput?.kind === "results") {
    result = <ResultsBody output={validOutput} Markdown={Markdown} />;
  } else if (validOutput) {
    result = <AnswerBody output={validOutput} Markdown={Markdown} />;
  } else {
    result = <ToolResultFallback output={output} pendingLabel="Searching…" />;
  }
  return (
    <ToolRow
      name="web_search"
      summary={z.object({ query: z.string() }).safeParse(input).data?.query}
      input={input}
      errorText={errorText}
      state={state}
    >
      {result}
    </ToolRow>
  );
}
