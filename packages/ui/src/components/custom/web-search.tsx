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

const markdownSpecialCharacterPattern = /([\\`*_[\]{}()#+\-.!|<>~])/gu;

/** The normalized result shape displayed by the web search renderer. */
type WebSearchResult = {
  readonly title: string;
  readonly url: string;
  readonly snippet?: string;
  readonly published?: string;
};

type WebSearchCitation = {
  readonly url: string;
  readonly title?: string;
};

type WebSearchResultsOutput = {
  readonly status: "success";
  readonly kind: "results";
  readonly engine: string;
  readonly query: string;
  readonly notes?: ReadonlyArray<string>;
  readonly results: ReadonlyArray<WebSearchResult>;
};

type WebSearchAnswerOutput = {
  readonly status: "success";
  readonly kind: "answer";
  readonly engine: string;
  readonly query: string;
  readonly notes?: ReadonlyArray<string>;
  readonly answer: string;
  readonly citations: ReadonlyArray<WebSearchCitation>;
};

type WebSearchOutput = WebSearchResultsOutput | WebSearchAnswerOutput;

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

const stringArraySchema = z.array(z.string());

function isStringArray(
  value: unknown,
): value is ReadonlyArray<string> | undefined {
  return value === undefined || stringArraySchema.safeParse(value).success;
}

function isWebSearchResult(value: unknown): value is WebSearchResult {
  if (typeof value !== "object" || value === null) return false;
  if (!("title" in value) || !("url" in value)) return false;
  return (
    typeof value.title === "string" &&
    typeof value.url === "string" &&
    (!("snippet" in value) ||
      value.snippet === undefined ||
      typeof value.snippet === "string") &&
    (!("published" in value) ||
      value.published === undefined ||
      typeof value.published === "string")
  );
}

function isWebSearchCitation(value: unknown): value is WebSearchCitation {
  if (typeof value !== "object" || value === null) return false;
  return (
    "url" in value &&
    typeof value.url === "string" &&
    (!("title" in value) ||
      value.title === undefined ||
      typeof value.title === "string")
  );
}

function isWebSearchOutput(value: unknown): value is WebSearchOutput {
  if (typeof value !== "object" || value === null) return false;
  const notes = "notes" in value ? value.notes : undefined;
  if (
    !("status" in value) ||
    !("engine" in value) ||
    !("query" in value) ||
    !("kind" in value) ||
    value.status !== "success" ||
    typeof value.engine !== "string" ||
    typeof value.query !== "string" ||
    !isStringArray(notes)
  )
    return false;

  if (value.kind === "results") {
    return (
      "results" in value &&
      Array.isArray(value.results) &&
      value.results.every(isWebSearchResult)
    );
  }

  return (
    value.kind === "answer" &&
    "answer" in value &&
    typeof value.answer === "string" &&
    "citations" in value &&
    Array.isArray(value.citations) &&
    value.citations.every(isWebSearchCitation)
  );
}

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
  return value
    .replaceAll("\\", "%5C")
    .replaceAll("<", "%3C")
    .replaceAll(">", "%3E")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

function markdownLink(label: string, url: string): string {
  return `[${escapeMarkdown(label)}](<${escapeMarkdownUrl(url)}>)`;
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
  const renderedLabel = parsedUrl
    ? markdownLink(label, parsedUrl.href)
    : escapeMarkdown(label);

  return <Markdown>{renderedLabel}</Markdown>;
}

function SearchMetadata({
  engine,
  notes,
}: {
  engine: string;
  notes: ReadonlyArray<string> | undefined;
}) {
  return (
    <footer className="border-border border-t px-4 py-3 text-muted-foreground text-xs">
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
    </footer>
  );
}

function ResultItem({
  result,
  index,
  Markdown,
}: {
  result: WebSearchResult;
  index: number;
  Markdown: ComponentType<{ children?: string }>;
}) {
  const parsedUrl = parseHttpUrl(result.url);
  const host = parsedUrl?.host;
  const hasMetadata =
    host !== undefined ||
    result.published !== undefined ||
    result.snippet !== undefined;

  return (
    <li className="pl-1" key={`${result.url}-${index}`}>
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
              index={index}
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

function SearchingBody() {
  return <p className="p-4 text-muted-foreground text-sm">Searching…</p>;
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
  const validOutput = isWebSearchOutput(output) ? output : undefined;

  return (
    <Tool>
      <ToolHeader state={state} title="web_search" type="tool-web_search" />
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
          <SearchingBody />
        )}
      </ToolContent>
    </Tool>
  );
}
