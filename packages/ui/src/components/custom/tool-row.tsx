"use client";

import type { ReactElement, ReactNode } from "react";

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
