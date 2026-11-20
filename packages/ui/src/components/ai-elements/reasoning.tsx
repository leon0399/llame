"use client";

import {
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@workspace/ui/components/trace";
import { cn } from "@workspace/ui/lib/utils";
import { CircleCheckIcon, LoaderCircleIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type ReasoningContextValue = {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
  title: string | undefined;
};

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
  const context = useContext(ReasoningContext);

  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }

  return context;
};

export type ReasoningProps = Omit<
  ComponentProps<typeof TraceCollapsible>,
  "open" | "onOpenChange" | "defaultOpen"
> & {
  /**
   * Whether the model is still streaming reasoning tokens. While `true` the
   * line reads "Thinking" and is open; when it flips to `false` the elapsed
   * time is captured into `duration` and the line closes, unless the reader
   * opened or closed it themselves.
   */
  isStreaming?: boolean;
  /** Controlled open state. Omit to let the line follow `isStreaming`. */
  open?: boolean;
  /**
   * Where the line starts, as if the reader had set it: the line then keeps
   * that state instead of following `isStreaming`.
   */
  defaultOpen?: boolean;
  /** Called when the reader opens or closes the line. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Elapsed reasoning time in seconds, shown by the default trigger message
   * (e.g. "Thought for 4s"). Omit to let the component derive it from how
   * long `isStreaming` was `true`.
   */
  duration?: number;
  /**
   * What the thought is about: the heading of its latest summary section
   * (see `latestReasoningHeading`). The default trigger shows it in place of
   * "Thinking" and "Thought".
   */
  title?: string;
};

const MS_IN_S = 1000;

/**
 * Reasoning displays a model's thinking as a trace line that expands into the
 * thought. It reads "Thinking" and is open while the model thinks, then reads
 * "Thought" and closes; the reader's own choice wins over both. Compose it
 * with `ReasoningTrigger` and `ReasoningContent`, inside a `Trace`.
 *
 * Follows the shadcn/ui [Reasoning](https://ui.shadcn.com/docs/ai-elements/base/reasoning)
 * pattern, keeping the exports and props of the AI Elements `Reasoning`.
 *
 * @summary for a collapsible view of a model's reasoning/thinking output
 */
export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen,
    onOpenChange,
    duration: durationProp,
    title,
    children,
    ...props
  }: ReasoningProps) => {
    // Undefined until the reader toggles the line; until then it follows
    // `isStreaming`.
    const [chosen, setChosen] = useState(defaultOpen);
    const isOpen = open ?? chosen ?? isStreaming;

    const [measured, setMeasured] = useState<number>();
    const duration = durationProp ?? measured;
    // When the current streaming pass began. A ref, not state: the start time
    // is never rendered, and the value written when a pass ends is `measured`.
    const startTimeRef = useRef<number | null>(null);

    useEffect(() => {
      if (isStreaming) {
        startTimeRef.current ??= Date.now();
      } else if (startTimeRef.current !== null) {
        const startTime = startTimeRef.current;
        startTimeRef.current = null;
        setMeasured(Math.ceil((Date.now() - startTime) / MS_IN_S));
      }
    }, [isStreaming]);

    const setIsOpen = (next: boolean) => {
      setChosen(next);
      onOpenChange?.(next);
    };

    return (
      <ReasoningContext.Provider
        value={{ isStreaming, isOpen, setIsOpen, duration, title }}
      >
        <TraceCollapsible
          // Off-screen paint deferred via globals.css (content-visibility).
          data-transcript-reasoning=""
          className={cn("not-prose", className)}
          {...props}
          onOpenChange={setIsOpen}
          open={isOpen}
        >
          {children}
        </TraceCollapsible>
      </ReasoningContext.Provider>
    );
  },
);

export type ReasoningTriggerProps = ComponentProps<
  typeof TraceCollapsibleTrigger
> & {
  /**
   * Renders the trigger's label given the current streaming state and
   * elapsed `duration` (seconds) from the enclosing `Reasoning`. Defaults to
   * "Thinking" while streaming, where the line shimmers, then "Thought for
   * Ns" once finished. Pass `children` instead to replace the whole line.
   */
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

const defaultGetThinkingMessage = (isStreaming: boolean, duration?: number) => {
  if (isStreaming) {
    return "Thinking";
  }

  return duration === undefined || duration === 0
    ? "Thought"
    : `Thought for ${duration}s`;
};

/** The seconds a titled thought took, shown after its title. */
function titledDuration(isStreaming: boolean, duration: number | undefined) {
  return isStreaming || duration === undefined || duration === 0
    ? null
    : `${duration}s`;
}

/**
 * ReasoningTrigger toggles its `Reasoning`'s open state and shows a
 * streaming-aware label (thinking vs. elapsed duration) by default.
 *
 * @summary for the control that expands/collapses a Reasoning panel
 */
export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, duration, title } = useReasoning();
    const seconds = titledDuration(isStreaming, duration);

    return (
      <TraceCollapsibleTrigger className={className} {...props}>
        {children ?? (
          <TraceLine status={isStreaming ? "running" : undefined}>
            <TraceIcon>
              {isStreaming ? (
                <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
              ) : (
                <CircleCheckIcon />
              )}
            </TraceIcon>
            <TraceTitle>
              {title || getThinkingMessage(isStreaming, duration)}
            </TraceTitle>
            {title ? (
              <span className="sr-only">
                {isStreaming ? ", Thinking" : ", Thought"}
              </span>
            ) : null}
            {title && seconds ? (
              <TraceDescription>{seconds}</TraceDescription>
            ) : null}
          </TraceLine>
        )}
      </TraceCollapsibleTrigger>
    );
  },
);

Reasoning.displayName = "Reasoning";

ReasoningTrigger.displayName = "ReasoningTrigger";
