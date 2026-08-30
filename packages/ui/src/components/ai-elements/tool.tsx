"use client";

import { Badge } from "@workspace/ui/components/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { cn } from "@workspace/ui/lib/utils";
import type { ToolUIPart } from "ai";
import {
  BanIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { CodeBlock } from "@workspace/ui/components/ai-elements/code-block";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

// Guard values JSON.stringify can't serialize (circular refs, BigInt) so a
// single tool payload can't throw during render and blank the whole chat.
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export type ToolProps = ComponentProps<typeof Collapsible>;

/**
 * Collapsible container for a single tool invocation in a chat message.
 * Compose it with `ToolHeader` (title + status badge) and `ToolContent`
 * (parameters + result) so an agent's tool call renders as an expandable
 * row instead of raw JSON inline in the transcript.
 *
 * @see https://elements.ai-sdk.dev/components/tool
 */
export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    // `group` so ToolHeader's chevron `group-data-[state=open]:rotate-180`
    // has a data-state-bearing ancestor to match.
    className={cn("group not-prose mb-4 w-full rounded-md border", className)}
    {...props}
  />
);

/**
 * The SDK's `ToolUIPart["state"]` plus `"cancelled"` — the one lifecycle state
 * this codebase adds. The SDK has no cancelled value, so the bridge emits
 * `output-error` and the chat page maps it to `"cancelled"` based on the
 * settlement marker before passing it here.
 */
export type ToolHeaderState = ToolUIPart["state"] | "cancelled";

export type ToolHeaderProps = {
  /** Display title; defaults to `type` with its leading `tool-` segment stripped. */
  title?: string;
  /** The tool's UI part type, e.g. `"tool-search_conversations"` (a `tool-${name}` template literal). */
  type: ToolUIPart["type"];
  /**
   * Lifecycle state of the invocation; selects the status badge's icon and
   * label. Accepts the SDK's states plus `"cancelled"` — a run terminated by
   * the user, rendered with neutral styling rather than the red error badge.
   */
  state: ToolHeaderState;
  className?: string;
};

const getStatusBadge = (status: ToolHeaderState) => {
  const labels = {
    "input-streaming": "Pending",
    "input-available": "Running",
    "approval-requested": "Awaiting Approval",
    "approval-responded": "Responded",
    "output-available": "Completed",
    "output-error": "Error",
    "output-denied": "Denied",
    cancelled: "Cancelled",
  } satisfies Record<ToolHeaderState, string>;

  const icons = {
    "input-streaming": <CircleIcon className="size-4" />,
    "input-available": <ClockIcon className="size-4 animate-pulse" />,
    "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
    "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
    "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
    "output-error": <XCircleIcon className="size-4 text-red-600" />,
    "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
    cancelled: <BanIcon className="size-4 text-muted-foreground" />,
  } satisfies Record<ToolHeaderState, ReactNode>;

  return (
    <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
      {icons[status]}
      {labels[status]}
    </Badge>
  );
};

/**
 * `CollapsibleTrigger` row for a `Tool`: a wrench icon, the tool's title (or
 * `type`), and a status badge derived from `state`. Toggles the collapsible
 * content open/closed.
 */
export const ToolHeader = ({
  className,
  title,
  type,
  state,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "flex w-full items-center justify-between gap-4 p-3",
      className,
    )}
    {...props}
  >
    <div className="flex items-center gap-2">
      <WrenchIcon className="size-4 text-muted-foreground" />
      <span className="font-medium text-sm">
        {title ?? type.split("-").slice(1).join("-")}
      </span>
      {getStatusBadge(state)}
    </div>
    <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

/**
 * Collapsible body of a `Tool`; typically wraps a `ToolInput` and/or
 * `ToolOutput` panel that reveal when the header is expanded.
 */
export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className,
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  /**
   * The tool call's arguments, rendered as pretty-printed JSON. `undefined`
   * (e.g. during `input-streaming`) renders nothing rather than a
   * "Parameters" panel with no content.
   */
  input: ToolUIPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => {
  // Omit the panel until arguments exist: during input-streaming `input` is
  // undefined, and JSON.stringify(undefined) -> the value `undefined` crashes
  // Shiki's highlighter (an unhandled promise rejection).
  if (input === undefined) {
    return null;
  }

  return (
    <div className={cn("space-y-2 overflow-hidden p-4", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        Parameters
      </h4>
      <div className="rounded-md bg-muted/50">
        <CodeBlock code={safeStringify(input)} language="json" />
      </div>
    </div>
  );
};

export type ToolOutputProps = ComponentProps<"div"> & {
  /**
   * The tool call's result. A React element is rendered as-is; a string or
   * any other JSON-serializable value is rendered as pretty-printed JSON.
   * Ignored while `errorText` is set.
   */
  output: ToolUIPart["output"];
  /** Error message from a failed tool call; renders an error panel instead of `output`. */
  errorText: ToolUIPart["errorText"];
  /** Distinguishes a termination-settled result from a genuine tool error so
   *  the expanded panel stays neutral as well as its header badge. */
  state?: Extract<ToolHeaderState, "output-error" | "cancelled">;
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  state,
  ...props
}: ToolOutputProps) => {
  if (output === undefined && !errorText) {
    return null;
  }

  // Render every real result, including falsy ones (0, false, "", null) that
  // the previous `!(output || errorText)` guard silently swallowed.
  let Output: ReactNode = null;
  if (isValidElement(output)) {
    Output = output;
  } else if (isString(output)) {
    Output = <CodeBlock code={output} language="json" />;
  } else if (output !== undefined) {
    Output = <CodeBlock code={safeStringify(output)} language="json" />;
  }

  const cancelled = state === "cancelled";

  return (
    <div className={cn("space-y-2 p-4", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? (cancelled ? "Cancelled" : "Error") : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText && !cancelled
            ? "bg-destructive/10 text-destructive"
            : "bg-muted/50 text-foreground",
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
