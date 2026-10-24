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

const inputSchema = z.object({
  mode: z.enum(["content", "timeline"]),
  query: z.string().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
});

const resultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("content"),
    chatId: z.string(),
    title: z.string().nullable(),
    role: z.string(),
    timestamp: z.string(),
    messageSeq: z.number(),
    excerpt: z.string(),
  }),
  z.object({
    kind: z.literal("metadata"),
    chatId: z.string(),
    title: z.string().nullable(),
    updatedAt: z.string(),
  }),
  z.object({
    kind: z.literal("timeline"),
    chatId: z.string(),
    title: z.string().nullable(),
    firstActivityAt: z.string(),
    lastActivityAt: z.string(),
    messageCount: z.number(),
  }),
]);

/** Loose: the runner's oversize cap may add `truncationNotice`. */
const outputSchema = z.looseObject({
  status: z.literal("success"),
  notice: z.string(),
  appliedRange: z.object({
    after: z.string().optional(),
    before: z.string().optional(),
    constraint: z.string().optional(),
  }),
  truncated: z.boolean(),
  results: z.array(resultSchema),
  truncationNotice: z.string().optional(),
});

type SearchOutput = z.infer<typeof outputSchema>;
type SearchResult = z.infer<typeof resultSchema>;

/** Props for the dedicated `search_conversations` tool row. */
export type SearchConversationsToolProps = ToolPartProps;

/** An ISO instant as `YYYY-MM-DD HH:MM` UTC: deterministic across locales
 *  and server/client renders. Anything else shows as given. */
export function formatInstant(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/u.exec(value);
  return match ? `${match[1]} ${match[2]}` : value;
}

/** A date window as `after – before`, either end open. */
function rangeLabel(range: { after?: string; before?: string }) {
  if (range.after === undefined && range.before === undefined) return undefined;
  const after = range.after === undefined ? "…" : formatInstant(range.after);
  const before = range.before === undefined ? "…" : formatInstant(range.before);
  return `${after} – ${before}`;
}

function ResultLine({ result }: { result: SearchResult }) {
  if (result.kind === "content") {
    return (
      <>
        <span className="font-medium">{result.title ?? "Untitled chat"}</span>
        <span className="text-muted-foreground">
          {" "}
          · {result.role} · {formatInstant(result.timestamp)} · #
          {result.messageSeq}
        </span>
        <blockquote className="mt-1 whitespace-pre-wrap break-words border-border border-l-2 pl-3 text-muted-foreground">
          {result.excerpt}
        </blockquote>
      </>
    );
  }
  return (
    <>
      <span className="font-medium">{result.title ?? "Untitled chat"}</span>
      <span className="text-muted-foreground">
        {result.kind === "metadata"
          ? ` · title match · updated ${formatInstant(result.updatedAt)}`
          : ` · ${result.messageCount} messages · ${formatInstant(result.firstActivityAt)} – ${formatInstant(result.lastActivityAt)}`}
      </span>
    </>
  );
}

function SearchResults({ output }: { output: SearchOutput }) {
  const count = output.results.length;
  return (
    <>
      <ToolSection
        label="Conversations"
        aside={
          count === 0
            ? undefined
            : `${count} ${count === 1 ? "result" : "results"}`
        }
      >
        {count === 0 ? (
          <p className="text-muted-foreground text-sm">
            No conversations found.
          </p>
        ) : (
          <ul className="space-y-3 text-sm">
            {output.results.map((result, index) => (
              // A chat can match more than once; position is the identity.
              <li className="break-words" key={`${result.chatId}-${index}`}>
                <ResultLine result={result} />
              </li>
            ))}
          </ul>
        )}
      </ToolSection>
      <ToolDetails
        rows={[
          ["Range", rangeLabel(output.appliedRange)],
          ["Range constraint", output.appliedRange.constraint],
          ["Truncated", output.truncated ? "yes" : undefined],
          ["Note", output.truncationNotice],
          ["Notice", output.notice],
        ]}
      />
    </>
  );
}

/**
 * Renders a `search_conversations` invocation: the owner's past chats that
 * matched, each with its title and either a quoted excerpt of the matching
 * message, a title-only match, or its activity window in timeline mode.
 *
 * @summary displays a search over past conversations inside a collapsible tool row
 */
export function SearchConversationsTool({
  input,
  output,
  errorText,
  state,
}: SearchConversationsToolProps): ReactElement {
  const search = inputSchema.safeParse(input).data;
  const result = outputSchema.safeParse(output).data;
  return (
    <ToolRow
      name="search_conversations"
      summary={
        search?.mode === "content" ? search.query : search && rangeLabel(search)
      }
      input={input}
      errorText={errorText}
      state={state}
    >
      {result ? (
        <SearchResults output={result} />
      ) : (
        <ToolResultFallback output={output} pendingLabel="Searching…" />
      )}
    </ToolRow>
  );
}
