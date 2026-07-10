"use client";

import { useState } from "react";
import { ChevronRightIcon, WrenchIcon } from "lucide-react";

import { Badge } from "@workspace/ui/components/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The coarse states this renderer distinguishes, mapped from the AI SDK's
 * `ToolUIPart`/`DynamicToolUIPart` `state` field (`input-streaming` →
 * `input-available` → `output-available` | `output-error`). Approval states
 * (`approval-requested`, `approval-responded`, `output-denied`) can't occur
 * in this slice — every executable tool is `read_only` and the approval
 * framework (SPEC §7.5) arrives with the first write-capable tool
 * (design.md Non-Goals) — so they fall back to "running" rather than
 * getting dedicated UI.
 */
export type ToolActivityStatus = "calling" | "running" | "done" | "error";

const STATUS_BY_STATE: Record<string, ToolActivityStatus> = {
  "input-streaming": "calling",
  "input-available": "running",
  "output-available": "done",
  "output-error": "error",
};

/** Maps a part's raw `state` to the coarse status this renderer shows.
 * Unknown/future states default to "running" (still in flight) rather than
 * silently rendering nothing. */
export function toolActivityStatus(state: string): ToolActivityStatus {
  return STATUS_BY_STATE[state] ?? "running";
}

const STATUS_LABEL: Record<ToolActivityStatus, string> = {
  calling: "calling…",
  running: "running…",
  done: "done",
  error: "error",
};

const STATUS_BADGE_VARIANT: Record<
  ToolActivityStatus,
  "outline" | "secondary" | "destructive"
> = {
  calling: "outline",
  running: "outline",
  // Alert Red reserved for destructive/invalid states (DESIGN.md §10) — a
  // tool error is exactly that; the other three states stay achromatic.
  done: "secondary",
  error: "destructive",
};

function formatArgValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  // Nested object/array — kept out of the one-line summary; the expanded
  // panel below already shows the full JSON.
  return "…";
}

const ARGS_SUMMARY_MAX_CHARS = 80;

/**
 * A short "key: value, key2: value2" summary of a tool call's arguments for
 * the collapsed header — the full input is still available on expand. Pure
 * so it's unit-tested without rendering.
 */
export function summarizeToolInput(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "object" || input === null) {
    return formatArgValue(input);
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  const summary = entries
    .map(([key, value]) => `${key}: ${formatArgValue(value)}`)
    .join(", ");
  return summary.length > ARGS_SUMMARY_MAX_CHARS
    ? `${summary.slice(0, ARGS_SUMMARY_MAX_CHARS)}…`
    : summary;
}

/**
 * A `tool-<name>` (or `dynamic-tool`) UI message part (tool-calling loop):
 * the agent's tool use, made visible. Collapsed by default — a chip showing
 * the tool name, an args summary, and a call → running → result/error
 * state; expanded shows the full input arguments and the tool result or
 * error. Renders identically whether `state`/`input`/`output`/`errorText`
 * arrived live (streamed) or from persisted history — one component, one
 * prop contract, no separate "historical" path (design.md D5, spec's
 * "Tool activity is rendered in the chat UI" requirement).
 */
export function ToolCallPart({
  toolName,
  state,
  input,
  output,
  errorText,
}: {
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}) {
  const [open, setOpen] = useState(false);
  const status = toolActivityStatus(state);
  const argsSummary = summarizeToolInput(input);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-border bg-muted/40 my-1 w-full rounded-lg border"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-sm">
        <ChevronRightIcon
          className={cn(
            "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <WrenchIcon className="text-muted-foreground h-4 w-4 shrink-0" />
        <span className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden text-left">
          <span className="shrink-0 font-medium">{toolName}</span>
          {argsSummary && (
            <span className="text-muted-foreground truncate text-xs">
              {argsSummary}
            </span>
          )}
        </span>
        <Badge
          variant={STATUS_BADGE_VARIANT[status]}
          className="ml-auto shrink-0"
        >
          {STATUS_LABEL[status]}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-3 pb-3">
        {input !== undefined && (
          <div>
            <p className="text-muted-foreground mb-1 text-xs">Input</p>
            <pre className="bg-background overflow-x-auto rounded-md p-2 text-xs">
              {safeStringify(input)}
            </pre>
          </div>
        )}
        {output !== undefined && (
          <div>
            <p className="text-muted-foreground mb-1 text-xs">Result</p>
            <pre className="bg-background overflow-x-auto rounded-md p-2 text-xs">
              {safeStringify(output)}
            </pre>
          </div>
        )}
        {errorText !== undefined && (
          <div>
            <p className="text-muted-foreground mb-1 text-xs">Error</p>
            <p className="text-destructive text-xs">{errorText}</p>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
