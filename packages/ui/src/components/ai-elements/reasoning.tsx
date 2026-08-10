"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { cn } from "@workspace/ui/lib/utils";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { createContext, memo, useContext, useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import { Shimmer } from "@workspace/ui/components/ai-elements/shimmer";

import {
  REGEX_TOKEN_TAG,
  regexTokenAllowedTags,
  remarkRegexTokens,
} from "@workspace/ui/components/ai-elements/regex-streamdown";
import {
  RegexProseToken,
  RegexTesterProvider,
} from "@workspace/ui/components/ai-elements/regex-tester";
import { streamdownPlugins } from "@workspace/ui/components/ai-elements/streamdown-plugins";

type ReasoningContextValue = {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
};

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  /**
   * Whether the model is still streaming reasoning tokens. While `true` the
   * panel auto-opens and `ReasoningTrigger`'s default message shows the
   * animated "Thinking…" label. When it flips to `false`, the elapsed time
   * since streaming started is captured into `duration` and the panel
   * auto-closes once, shortly after.
   */
  isStreaming?: boolean;
  /** Controlled open state. Omit to let the component manage its own via `defaultOpen`/`onOpenChange`. */
  open?: boolean;
  /**
   * Initial open state for uncontrolled usage. Defaults to `true` so
   * reasoning is visible as it streams in; the component auto-collapses it
   * once after streaming ends.
   */
  defaultOpen?: boolean;
  /** Called whenever the open state changes, from user interaction or the auto-close behavior. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Elapsed reasoning time in seconds, shown by the default trigger message
   * (e.g. "Thought for 4 seconds"). Controlled like `open`/`onOpenChange`;
   * omit to let the component derive it automatically from how long
   * `isStreaming` was `true`.
   */
  duration?: number;
};

const AUTO_CLOSE_DELAY = 1000;
const MS_IN_S = 1000;

/**
 * Reasoning displays a model's chain-of-thought as a collapsible panel that
 * auto-opens while streaming and auto-collapses shortly after it finishes, so
 * a completed reasoning trace doesn't stay expanded and compete with the
 * final answer. Compose it with `ReasoningTrigger` and `ReasoningContent`.
 *
 * Vendored from [AI Elements Reasoning](https://elements.ai-sdk.dev/components/reasoning).
 *
 * @summary for a collapsible view of a model's reasoning/thinking output
 */
export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen = true,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      prop: open,
      defaultProp: defaultOpen,
      onChange: onOpenChange,
    });
    const [duration, setDuration] = useControllableState({
      prop: durationProp,
      defaultProp: undefined,
    });

    const [hasAutoClosed, setHasAutoClosed] = useState(false);
    const [startTime, setStartTime] = useState<number | null>(null);

    // Track duration when streaming starts and ends
    useEffect(() => {
      if (isStreaming) {
        if (startTime === null) {
          setStartTime(Date.now());
        }
      } else if (startTime !== null) {
        setDuration(Math.ceil((Date.now() - startTime) / MS_IN_S));
        setStartTime(null);
      }
    }, [isStreaming, startTime, setDuration]);

    // Auto-open when streaming starts, auto-close when streaming ends (once only)
    useEffect(() => {
      if (defaultOpen && !isStreaming && isOpen && !hasAutoClosed) {
        // Add a small delay before closing to allow user to see the content
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosed(true);
        }, AUTO_CLOSE_DELAY);

        return () => clearTimeout(timer);
      }
    }, [isStreaming, isOpen, defaultOpen, setIsOpen, hasAutoClosed]);

    const handleOpenChange = (newOpen: boolean) => {
      setIsOpen(newOpen);
    };

    return (
      <ReasoningContext.Provider
        value={{ isStreaming, isOpen, setIsOpen, duration }}
      >
        <Collapsible
          className={cn("not-prose mb-4", className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  },
);

export type ReasoningTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  /**
   * Renders the trigger's label given the current streaming state and
   * elapsed `duration` (seconds) from the enclosing `Reasoning`. Defaults to
   * an animated "Thinking…" shimmer while streaming, then "Thought for N
   * seconds" once finished. Pass `children` instead to replace the whole
   * trigger content (icon and chevron included).
   */
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

const defaultGetThinkingMessage = (isStreaming: boolean, duration?: number) => {
  if (isStreaming || duration === 0) {
    return <Shimmer duration={1}>Thinking...</Shimmer>;
  }
  if (duration === undefined) {
    return <p>Thought for a few seconds</p>;
  }
  return <p>Thought for {duration} seconds</p>;
};

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
    const { isStreaming, isOpen, duration } = useReasoning();

    return (
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground",
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            <BrainIcon className="size-4" />
            {getThinkingMessage(isStreaming, duration)}
            <ChevronDownIcon
              className={cn(
                "size-4 transition-transform",
                isOpen ? "rotate-180" : "rotate-0",
              )}
            />
          </>
        )}
      </CollapsibleTrigger>
    );
  },
);

export type ReasoningContentProps = ComponentProps<
  typeof CollapsibleContent
> & {
  /** The reasoning text, rendered as markdown via Streamdown. */
  children: string;
};

/**
 * ReasoningContent is the panel toggled by `ReasoningTrigger`; it renders
 * `children` as markdown via Streamdown.
 *
 * @summary for the markdown-rendered body of a Reasoning panel
 */
export const ReasoningContent = memo(
  ({ className, children, ...props }: ReasoningContentProps) => (
    <CollapsibleContent
      className={cn(
        "mt-4 text-sm",
        "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
        className,
      )}
      {...props}
    >
      {/* fork: reasoning is model output — harden Streamdown (external-link
          confirmation modal; images dropped, out of scope). Do not spread
          Collapsible props onto Streamdown. */}
      {/* The regex-tester wiring mirrors MessageResponse's: the shared
          `plugins` object already decorates code-block literals, so without
          the provider + components trio those spans would render underlined
          but inert here. */}
      <RegexTesterProvider>
        <Streamdown
          plugins={streamdownPlugins}
          components={{ [REGEX_TOKEN_TAG]: RegexProseToken }}
          remarkPlugins={[remarkRegexTokens]}
          allowedTags={regexTokenAllowedTags}
          linkSafety={{ enabled: true }}
          disallowedElements={["img"]}
        >
          {children}
        </Streamdown>
      </RegexTesterProvider>
    </CollapsibleContent>
  ),
);

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
