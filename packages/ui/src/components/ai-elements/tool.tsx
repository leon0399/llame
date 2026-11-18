"use client";

import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@workspace/ui/components/code-block";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@workspace/ui/components/trace";
import { cn } from "@workspace/ui/lib/utils";
import type { ToolUIPart } from "ai";
import {
  CircleStopIcon,
  FilePenLineIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderInputIcon,
  FolderOutputIcon,
  GlobeIcon,
  HourglassIcon,
  LibraryIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
  PlugIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { createContext, isValidElement, useContext } from "react";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Presentation metadata follows a call through its specialized renderer. */
const ToolIntentContext = createContext<string | undefined>(undefined);
export const ToolIntent = ToolIntentContext.Provider;

/** Reads only the stored presentation field, never executor arguments. */
export function toolIntent(part: unknown): string | undefined {
  if (!(part instanceof Object) || !("intent" in part)) return undefined;

  return isString(part.intent) && part.intent.trim() !== ""
    ? part.intent
    : undefined;
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

/** A `Tool` owns its open state; set where it starts with `defaultOpen`. */
export type ToolProps = Omit<
  ComponentProps<typeof TraceCollapsible>,
  "open" | "onOpenChange"
>;

/**
 * One tool invocation in a chat message, as a single trace line that expands
 * into its parameters and result. Compose it with `ToolHeader` (the line) and
 * `ToolContent` (the panel), and put consecutive calls in one `Trace` so they
 * read as steps rather than as separate cards.
 *
 * Follows the shadcn/ui [Tool](https://ui.shadcn.com/docs/ai-elements/base/tool)
 * pattern, keeping the exports and props of the AI Elements `Tool`.
 */
export const Tool = ({ className, ...props }: ToolProps) => (
  <TraceCollapsible
    // `data-transcript-tool`: off-screen paint deferred via globals.css
    // (content-visibility), matching OpenCode's tool-trigger treatment.
    data-transcript-tool=""
    className={cn("not-prose", className)}
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
  /** One-line digest of the call (a path, a command, a query): what the
   *  line's verb acts on; truncated with an ellipsis. */
  summary?: string;
  /**
   * Lifecycle state of the invocation; selects the line's status and the
   * tense of its title. Accepts the SDK's states plus `"cancelled"` — a run
   * terminated by the user, rendered with neutral styling rather than as an
   * error.
   */
  state: ToolHeaderState;
  /**
   * What a settled call came to when its state does not say: a command that
   * ran and exited non-zero, or one moved to the background. `verb` replaces
   * the tense's verb, `trailing` follows the summary ("exited with code 1"),
   * and `failed` marks the line as an error.
   */
  outcome?: { verb?: string; trailing?: string; failed?: boolean };
  /**
   * The model's own phrase for what the call is for (see `toolIntent`). When
   * set it is the line's title, and what the call did follows as the
   * description, so the intent never stands in for the command.
   */
  intent?: string;
  className?: string;
};

/** A tool's icon and what its line says it is doing, did, or failed to do. */
type ToolPhrase = {
  icon: ReactNode;
  running: string;
  done: string;
  failed: string;
};

/** The phrase of each llame tool; its `summary` follows the verb. */
const TOOL_PHRASES = new Map<string, ToolPhrase>([
  [
    "bash",
    {
      icon: <TerminalIcon />,
      running: "Running",
      done: "Ran",
      failed: "Failed to run",
    },
  ],
  [
    "wait",
    {
      icon: <HourglassIcon />,
      running: "Waiting for",
      done: "Waited for",
      failed: "Failed to wait for",
    },
  ],
  [
    "stop",
    {
      icon: <CircleStopIcon />,
      running: "Stopping",
      done: "Stopped",
      failed: "Failed to stop",
    },
  ],
  [
    "read",
    {
      icon: <FileTextIcon />,
      running: "Reading",
      done: "Read",
      failed: "Failed to read",
    },
  ],
  [
    "edit",
    {
      icon: <FilePenLineIcon />,
      running: "Editing",
      done: "Edited",
      failed: "Failed to edit",
    },
  ],
  [
    "write",
    {
      icon: <FilePlusIcon />,
      running: "Writing",
      done: "Wrote",
      failed: "Failed to write",
    },
  ],
  [
    "grep",
    {
      icon: <SearchIcon />,
      running: "Searching for",
      done: "Searched for",
      failed: "Failed to search for",
    },
  ],
  [
    "web_search",
    {
      icon: <GlobeIcon />,
      running: "Searching the web for",
      done: "Searched the web for",
      failed: "Failed to search the web for",
    },
  ],
  [
    "search_conversations",
    {
      icon: <MessagesSquareIcon />,
      running: "Searching chats for",
      done: "Searched chats for",
      failed: "Failed to search chats for",
    },
  ],
  [
    "conversation_read",
    {
      icon: <MessageSquareTextIcon />,
      running: "Reading chat",
      done: "Read chat",
      failed: "Failed to read chat",
    },
  ],
  [
    "knowledge_search",
    {
      icon: <LibraryIcon />,
      running: "Searching knowledge for",
      done: "Searched knowledge for",
      failed: "Failed to search knowledge for",
    },
  ],
  [
    "enter_workspace",
    {
      icon: <FolderInputIcon />,
      running: "Entering",
      done: "Entered",
      failed: "Failed to enter",
    },
  ],
  [
    "exit_workspace",
    {
      icon: <FolderOutputIcon />,
      running: "Leaving",
      done: "Left",
      failed: "Failed to leave",
    },
  ],
]);

const GENERIC_PHRASE = {
  running: "Running",
  done: "Ran",
  failed: "Failed to run",
};

type ToolStatus = {
  /** The state's name, for assistive technology. */
  label: string;
  /** The trace line's status: what colors the line and animates its title. */
  line?: ComponentProps<typeof TraceLine>["status"];
  /** Which of the tool's phrases the title uses; absent, `verb` is the title's. */
  tense?: "running" | "done" | "failed";
  /** A verb the same for every tool, for a state no tool phrases itself. */
  verb?: string;
};

// The title's tense carries the state, as the Tool pattern maps it, so nothing
// here relies on color alone (DESIGN.md §2 keeps the interface achromatic).
const TOOL_STATUS = {
  "input-streaming": { label: "Pending", line: "running", tense: "running" },
  "input-available": { label: "Running", line: "running", tense: "running" },
  "approval-requested": {
    label: "Awaiting Approval",
    verb: "Awaiting approval for",
  },
  "approval-responded": {
    label: "Responded",
    line: "running",
    tense: "running",
  },
  "output-available": { label: "Completed", tense: "done" },
  "output-error": { label: "Error", line: "error", tense: "failed" },
  "output-denied": { label: "Denied", verb: "Denied" },
  cancelled: { label: "Cancelled", verb: "Cancelled" },
} satisfies Record<ToolHeaderState, ToolStatus>;

/**
 * The trace line of a `Tool`: the tool's icon and a title in the tense of its
 * state — "Running pnpm test", "Ran pnpm test", "Failed to run pnpm test".
 * Toggles the content open and closed.
 */
export const ToolHeader = ({
  className,
  title,
  type,
  summary,
  state,
  outcome,
  intent: suppliedIntent,
  ...props
}: ToolHeaderProps) => {
  const contextualIntent = useContext(ToolIntentContext);
  const intent = suppliedIntent ?? contextualIntent;

  const name = type.split("-").slice(1).join("-");
  const status: ToolStatus = TOOL_STATUS[state];
  const known = TOOL_PHRASES.get(name);
  // A tool's own verb needs something to act on; without a summary the line
  // falls back to the generic verb and the tool's name.
  const phrase = known && summary ? known : GENERIC_PHRASE;

  const verb =
    outcome?.verb ?? (status.tense ? phrase[status.tense] : status.verb);

  const named = phrase === GENERIC_PHRASE;

  // What the call did, in the tense of its state: the fact beside the intent.
  const action = (
    <>
      {verb}
      {named ? ` ${title ?? name}` : null}
      {summary ? (
        <>
          {" "}
          <span className="font-mono text-xs">{summary}</span>
        </>
      ) : null}
      {outcome?.trailing ? ` ${outcome.trailing}` : null}
    </>
  );

  return (
    <TraceCollapsibleTrigger className={className} {...props}>
      <TraceLine status={outcome?.failed === true ? "error" : status.line}>
        <TraceIcon>
          {known?.icon ??
            (name.startsWith("mcp__") ? <PlugIcon /> : <WrenchIcon />)}
        </TraceIcon>
        <TraceTitle>{intent ?? action}</TraceTitle>
        {intent ? (
          <TraceDescription className="min-w-0 flex-1 truncate">
            {action}
          </TraceDescription>
        ) : null}
        {/* The tool and its state by name, for assistive technology. */}
        <span className="sr-only">
          , {named ? "" : `${title ?? name}, `}
          {outcome?.failed === true ? "Error" : status.label}
        </span>
      </TraceLine>
    </TraceCollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof TraceCollapsibleContent>;

/**
 * The panel of a `Tool`; typically wraps a `ToolInput` and/or `ToolOutput`
 * that reveal when the line is expanded.
 */
export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <TraceCollapsibleContent
    className={cn("flex flex-col gap-3 text-foreground", className)}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<typeof CodeBlock> & {
  /**
   * The tool call's arguments, rendered as pretty-printed JSON. `undefined`
   * (e.g. during `input-streaming`) renders nothing rather than a
   * "Parameters" panel with no content.
   */
  input: ToolUIPart["input"];
};

export const ToolInput = ({ input, ...props }: ToolInputProps) => {
  if (input === undefined) {
    return null;
  }

  return (
    <CodeBlock size="sm" {...props}>
      <CodeBlockHeader>
        <CodeBlockTitle>Parameters</CodeBlockTitle>
      </CodeBlockHeader>
      <CodeBlockContent wrap className="max-h-64" aria-label="Parameters">
        {safeStringify(input)}
      </CodeBlockContent>
    </CodeBlock>
  );
};

export type ToolOutputProps = ComponentProps<"div"> & {
  /**
   * The tool call's result. A React element is rendered as-is; a string is
   * shown verbatim and any other JSON-serializable value as pretty-printed
   * JSON. Ignored while `errorText` is set.
   */
  output: ToolUIPart["output"];
  /** Error message from a failed tool call; renders an error panel instead of `output`. */
  errorText: ToolUIPart["errorText"];
  /** Distinguishes a termination-settled result from a genuine tool error so
   *  the expanded panel stays neutral as well as its line. */
  state?: Extract<ToolHeaderState, "output-error" | "cancelled">;
};

export const ToolOutput = ({
  output,
  errorText,
  state,
  ...props
}: ToolOutputProps) => {
  if (output === undefined && !errorText) {
    return null;
  }

  if (!errorText && isValidElement(output)) {
    return <div {...props}>{output}</div>;
  }

  const cancelled = state === "cancelled";
  const label = errorText ? (cancelled ? "Cancelled" : "Error") : "Result";
  // Every real result is shown, including falsy ones (0, false, "", null).
  const text = errorText || (isString(output) ? output : safeStringify(output));

  return (
    <CodeBlock
      size="sm"
      variant={errorText && !cancelled ? "destructive" : "default"}
      {...props}
    >
      <CodeBlockHeader>
        <CodeBlockTitle>{label}</CodeBlockTitle>
      </CodeBlockHeader>
      <CodeBlockContent wrap className="max-h-64" aria-label={label}>
        {text}
      </CodeBlockContent>
    </CodeBlock>
  );
};
