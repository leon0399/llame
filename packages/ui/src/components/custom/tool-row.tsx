"use client";

import type { ReactElement, ReactNode } from "react";
import { z } from "zod";

import { Badge } from "@workspace/ui/components/badge";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolHeaderState,
} from "@workspace/ui/components/ai-elements/tool";
import { ScrollRegion } from "@workspace/ui/components/custom/scroll-region";

/** What every dedicated tool row receives from its message part. */
export type ToolPartProps = {
  /** Tool arguments; dedicated rows parse the fields they display. */
  input: unknown;
  /** The tool's success result; malformed values fall back to generic JSON. */
  output: unknown;
  /** Error returned by the tool, if the invocation failed. */
  errorText: string | undefined;
  /** Current lifecycle state, including llame's cancellation state. */
  state: ToolHeaderState;
};

export type ToolRowProps = Pick<
  ToolPartProps,
  "input" | "errorText" | "state"
> & {
  /** The tool's registered name, e.g. `"grep"`. */
  name: string;
  /** Header title; defaults to `name`. */
  title?: string;
  /** One-line digest shown in the collapsed header. */
  summary?: string;
  /** Show the raw arguments panel; off when `preview` already shows them. */
  showInput?: boolean;
  /** Input-derived view shown in every state, e.g. an edit's diff. */
  preview?: ReactNode;
  /** The result view, shown unless the call failed or was cancelled. */
  children: ReactNode;
};

/**
 * The collapsible frame every dedicated tool row shares: header with a
 * summary, the arguments panel, an input-derived preview, then either the
 * result or a destructive error panel. A cancelled call shows neither: the
 * header's neutral Cancelled badge is the whole outcome, so the transport
 * error behind a user stop is never exposed.
 *
 * @summary frame for a dedicated tool row
 */
export function ToolRow({
  name,
  title,
  summary,
  input,
  errorText,
  state,
  showInput = true,
  preview,
  children,
}: ToolRowProps): ReactElement {
  let outcome: ReactNode = children;
  if (state === "cancelled") {
    outcome = null;
  } else if (errorText) {
    outcome = (
      <ToolOutput
        errorText={errorText}
        output={undefined}
        state="output-error"
      />
    );
  }
  return (
    <Tool>
      <ToolHeader
        type={`tool-${name}`}
        title={title}
        state={state}
        summary={summary}
      />
      <ToolContent>
        {showInput ? <ToolInput input={input} /> : null}
        {preview}
        {outcome}
      </ToolContent>
    </Tool>
  );
}

/** A result that did not parse as JSON, or a pending line before any. */
export function ToolResultFallback({
  output,
  pendingLabel = "Running…",
}: {
  output: unknown;
  pendingLabel?: string;
}): ReactElement {
  return output === undefined ? (
    <p className="p-4 text-muted-foreground text-sm">{pendingLabel}</p>
  ) : (
    <ToolOutput output={output} errorText={undefined} />
  );
}

/** A labelled block of a tool row, styled like the arguments panel's
 *  heading so every section of every row reads alike. `aside` sits at the
 *  heading's end, e.g. a diff's line counts. */
export function ToolSection({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-4">
        <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {label}
        </h4>
        {aside ? (
          <span className="font-mono text-muted-foreground text-xs">
            {aside}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Verbatim monospace text in a height-capped, keyboard-reachable region:
 *  command output, excerpts, remote tool text. */
export function ToolText({
  label,
  text,
}: {
  label: string;
  text: string;
}): ReactElement {
  return (
    <ScrollRegion label={label} className="rounded-md bg-muted/50">
      <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs">
        {text}
      </pre>
    </ScrollRegion>
  );
}

/** Labelled detail rows under a result: the facts its main view omits. */
export function ToolDetails({
  rows,
}: {
  rows: ReadonlyArray<readonly [string, string | undefined]>;
}): ReactElement | null {
  const shown = rows.filter(
    (row): row is readonly [string, string] => row[1] !== undefined,
  );
  if (shown.length === 0) return null;
  return (
    <ul className="space-y-0.5 border-border border-t px-4 py-3 text-muted-foreground text-xs">
      {shown.map(([label, value], index) => (
        <li className="break-words" key={`${label}-${index}`}>
          <span className="font-medium">{label}:</span> {value}
        </li>
      ))}
    </ul>
  );
}

const rankRecordSchema = z.object({
  model: z.string(),
  order: z.array(z.string()),
  scores: z.record(z.string(), z.number()),
  latencyMs: z.number(),
  costUsd: z.number().nullable(),
});

/** What a ranked call stores under `display.rerank`. */
export type RankRecord = z.infer<typeof rankRecordSchema>;

/** A part's `display`: every `rerank` field is optional because a grep result
 *  may store only `runLengths`, which is no rank record. A malformed display
 *  reads as none. */
const rankDisplayRecord = z.object({
  rerank: z
    .object({
      ...rankRecordSchema.partial().shape,
      runLengths: z.array(z.number().int().positive()).optional(),
    })
    .optional(),
});

export const rankDisplaySchema = z
  .unknown()
  .transform((value) => rankDisplayRecord.safeParse(value).data);

export type RankDisplay = z.infer<typeof rankDisplaySchema>;

/** The ranked call's record, or `undefined` for a part without one. */
export function rankRecordOf(display: RankDisplay): RankRecord | undefined {
  return rankRecordSchema.safeParse(display?.rerank).data;
}

/** The score of the judged item at `position` of the applied order, when the
 *  record judged it. */
export function rankScoreAt(
  record: RankRecord | undefined,
  position: number,
): { key: string; score: number } | undefined {
  const key = record?.order[position];
  const score = key === undefined ? undefined : record?.scores[key];
  return key === undefined || score === undefined ? undefined : { key, score };
}

/** One badge for a ranked part: the served model, latency, and cost. */
export function ToolRankBadge({
  record,
}: {
  record: RankRecord;
}): ReactElement {
  const cost =
    record.costUsd === null ? "cost unknown" : `$${record.costUsd.toFixed(4)}`;
  return (
    <Badge variant="secondary" className="max-w-full">
      <span className="truncate font-mono">
        Ranked by {record.model} · {Math.round(record.latencyMs)} ms · {cost}
      </span>
    </Badge>
  );
}

/** A judged item's score and the key of the run it belongs to. */
export function ToolRankScore({
  ordinal,
  itemKey,
  score,
}: {
  ordinal: number;
  itemKey: string;
  score: number;
}): ReactElement {
  return (
    <Badge variant="outline" className="font-mono">
      #{ordinal} · {itemKey} · score {score.toFixed(2)}
    </Badge>
  );
}
