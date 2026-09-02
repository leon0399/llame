"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { CheckIcon, RegexIcon } from "lucide-react";
import type {
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  UIEvent,
} from "react";
import { Children, isValidElement, useMemo, useRef, useState } from "react";

import {
  evaluateRegex,
  parseWholeRegexLiteral,
  splitBySpans,
  type RegexEvaluation,
} from "@workspace/ui/lib/regex-detect";
import { cn } from "@workspace/ui/lib/utils";
import { REGEX_TOKEN_ATTRIBUTE, isRegexTokenValue } from "#regex-tester/token";

/**
 * The interaction controller for regex tokens produced by the Markdown and
 * code-highlighter adapters. Any descendant carrying
 * `data-regex-token="/pattern/flags"` becomes a target:
 * clicking it opens a floating single-option menu ("Test regex") anchored to
 * it, which morphs into a live tester input, matching Linear's interaction.
 */

function isTextChild(child: ReactNode): child is string | number {
  return typeof child === "string" || typeof child === "number";
}

const extractText = (children: ReactNode): string => {
  let text = "";

  for (const child of Children.toArray(children)) {
    if (isTextChild(child)) {
      text += child;
    } else if (isValidElement<{ children?: ReactNode }>(child)) {
      text += extractText(child.props.children);
    }
  }

  return text;
};

const activateOnEnterOrSpace = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.currentTarget.click();
  }
};

/**
 * Renders a `<regex-token>` element from the markdown pipeline as a dotted
 * underlined inline token. The visible text is the literal itself; the
 * mirror `data-regex-token` attribute is what `RegexTesterProvider`'s click
 * delegation looks for. A `span[role=button]` rather than `<button>`: a real
 * button is an inline-block with UA `text-align: center`, so a literal long
 * enough to wrap renders as a centered slab instead of flowing inline like
 * the surrounding prose.
 */
export const RegexProseToken = ({ children }: { children?: ReactNode }) => {
  const text = extractText(children);

  // Whitelisting `<regex-token>` through sanitize also lets a model *write*
  // one: Streamdown parses raw HTML, so `<regex-token>anything</regex-token>`
  // in message content now survives to this component. Re-detect here so the
  // affordance is granted by the detector, never by the markup — model output
  // gains nothing from the tag it could not get by writing the literal in
  // plain prose.
  if (!parseWholeRegexLiteral(text)) {
    return <>{children}</>;
  }

  return (
    <span
      // A native <button> is unusable here — see the JSDoc above.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="button"
      tabIndex={0}
      {...{ [REGEX_TOKEN_ATTRIBUTE]: text }}
      onKeyDown={activateOnEnterOrSpace}
      className="cursor-pointer underline decoration-muted-foreground decoration-dotted decoration-1 underline-offset-3"
    >
      {children}
    </span>
  );
};

interface RegexTesterTarget {
  anchor: HTMLElement;
  pattern: string;
  flags: string;
  /** Portal container when the anchor lives inside a same-z overlay. */
  container: HTMLElement | undefined;
}

const menuItemClassName =
  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground";

interface RegexTesterPanelProps {
  pattern: string;
  flags: string;
}

type MatchSegment = { text: string; matched: boolean };

/**
 * Mirror of the input's text, purely for the highlight backgrounds: its
 * glyphs are transparent and sit exactly under the input's, so the marks
 * read as highlights inside the input itself.
 */
function MatchHighlightUnderlay({
  segments,
  underlayRef,
}: {
  segments: Array<MatchSegment>;
  underlayRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={underlayRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-x-hidden rounded-t-lg py-2 pr-9 pl-3 text-sm whitespace-pre"
    >
      {segments.map((segment, index) =>
        segment.matched ? (
          <mark
            key={index}
            // Achromatic, like a text selection (DESIGN.md §10: the
            // interface stays monochrome, only content and the chart ramp
            // carry color). Match state is already carried by the check
            // icon and the "Match" label, so no meaning rests on hue.
            className="rounded-[3px] bg-foreground/15 text-transparent dark:bg-foreground/25"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index} className="text-transparent">
            {segment.text}
          </span>
        ),
      )}
    </div>
  );
}

/** The "Match"/"No match" summary below the tester input, listing every value on a match. */
function MatchResultSummary({ result }: { result: RegexEvaluation | null }) {
  if (!result) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className="flex flex-col gap-1 border-t border-border px-3 py-2 text-sm"
    >
      {result.matched ? (
        <>
          <span className="text-muted-foreground">Match</span>
          {result.values.map((value, index) => (
            <span key={index} className="truncate">
              {value}
            </span>
          ))}
        </>
      ) : (
        <span className="text-muted-foreground">No match</span>
      )}
    </div>
  );
}

function MatchInput({
  value,
  onChange,
  onScroll,
}: {
  value: string;
  onChange: (value: string) => void;
  onScroll: (event: UIEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      // The tester exists only after an explicit user action; focus follows
      // that action, as in the reference interaction.
      // oxlint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onScroll={onScroll}
      placeholder="Enter text to match…"
      aria-label="Text to match"
      maxLength={1000}
      spellCheck={false}
      // Borderless like the reference, but focus still has to be visible
      // (DESIGN.md §6) — the input is autofocused, so without a ring a
      // keyboard user has no indication of where typing goes. Inset, so the
      // ring reads inside the popup's own rounded edge.
      className="relative w-full rounded-t-lg bg-transparent py-2 pr-9 pl-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset placeholder:text-muted-foreground"
    />
  );
}

/** Splits `input` around `result`'s match ranges for the highlight underlay. */
function useMatchSegments(input: string, result: RegexEvaluation | null) {
  return useMemo(
    () =>
      result
        ? splitBySpans(
            input,
            result.ranges,
            (text) => ({ text, matched: false }),
            (range) => ({
              text: input.slice(range.start, range.end),
              matched: true,
            }),
          )
        : [],
    [result, input],
  );
}

const RegexTesterPanel = ({ pattern, flags }: RegexTesterPanelProps) => {
  const [input, setInput] = useState("");
  const underlayRef = useRef<HTMLDivElement>(null);

  const result = useMemo(
    () => evaluateRegex(pattern, flags, input),
    [pattern, flags, input],
  );

  const segments = useMatchSegments(input, result);

  const syncScroll = (event: UIEvent<HTMLInputElement>) => {
    if (underlayRef.current) {
      underlayRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }
  };

  return (
    <div className="w-80">
      <div className="relative">
        <MatchHighlightUnderlay segments={segments} underlayRef={underlayRef} />
        <MatchInput value={input} onChange={setInput} onScroll={syncScroll} />
        {result?.matched ? (
          <CheckIcon
            aria-hidden
            className="absolute top-1/2 right-3 size-4 -translate-y-1/2"
          />
        ) : null}
      </div>
      <MatchResultSummary result={result} />
    </div>
  );
};

/**
 * Wraps rendered message markdown, delegates clicks on
 * `[data-regex-token]` descendants (prose buttons and decorated Shiki code
 * spans alike), and hosts the single floating menu/tester popover anchored
 * to whichever token was clicked.
 */
export type RegexTesterOverlayResolver = (
  anchor: HTMLElement,
) => HTMLElement | undefined;

/**
 * Owns the click-to-target state machine: which token (if any) is active,
 * whether the popover is open, and which stage it shows. Derives
 * `activeTarget` from `target` rather than syncing it through an effect —
 * Streamdown re-renders a block on every tick until it is complete, so a
 * token clicked mid-stream can have its DOM node replaced underneath us,
 * leaving the popover anchored to a detached element that measures as a
 * zero-size box at the origin. This provider re-renders with the message
 * content, so the stale anchor is gone from the same render that replaced
 * it.
 */
/**
 * Resolves the clicked `[data-regex-token]` descendant (if any) into a new
 * target, re-validating the attribute since it is DOM state, not trusted.
 */
function resolveClickTarget(
  event: MouseEvent<HTMLDivElement>,
  resolveOverlayContainer: RegexTesterOverlayResolver,
): RegexTesterTarget | null {
  const element =
    event.target instanceof Element
      ? event.target.closest(`[${REGEX_TOKEN_ATTRIBUTE}]`)
      : null;

  if (!(element instanceof HTMLElement)) {
    return null;
  }

  const rawValue = element.getAttribute(REGEX_TOKEN_ATTRIBUTE);
  const candidate = isRegexTokenValue(rawValue)
    ? parseWholeRegexLiteral(rawValue)
    : null;

  if (!candidate) {
    return null;
  }

  return {
    anchor: element,
    pattern: candidate.pattern,
    flags: candidate.flags,
    container: resolveOverlayContainer(element),
  };
}

function useRegexTesterState(
  resolveOverlayContainer: RegexTesterOverlayResolver,
) {
  const [target, setTarget] = useState<RegexTesterTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"menu" | "tester">("menu");

  const activeTarget = target?.anchor.isConnected ? target : null;

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const nextTarget = resolveClickTarget(event, resolveOverlayContainer);

    if (!nextTarget) {
      return;
    }

    setStage("menu");
    setOpen(true);
    setTarget(nextTarget);
  };

  // Closing drops the anchor immediately. Deferring it to
  // `onOpenChangeComplete` so the exit animation could play was tried and
  // reverted: the callback did not arrive, leaving an invisible popup
  // mounted on a stale anchor. There is no exit animation for the same
  // reason — see the popup's className below.
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);

    if (!nextOpen) {
      setTarget(null);
    }
  };

  return {
    activeTarget,
    open,
    stage,
    handleClick,
    handleOpenChange,
    startTest: () => setStage("tester"),
  };
}

function RegexTesterMenu({ onSelectTest }: { onSelectTest: () => void }) {
  return (
    <div role="menu" aria-label="Regex actions" className="p-1">
      <button
        type="button"
        role="menuitem"
        // Focus follows the click that opened the menu.
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        onClick={onSelectTest}
        className={menuItemClassName}
      >
        <RegexIcon aria-hidden className="size-4 text-muted-foreground" />
        Test regex
      </button>
    </div>
  );
}

type RegexTesterOverlayProps = {
  activeTarget: RegexTesterTarget;
  open: boolean;
  stage: "menu" | "tester";
  onOpenChange: (open: boolean) => void;
  onSelectTest: () => void;
};

/** The floating menu/tester popover, anchored to whichever token was clicked. */
function RegexTesterOverlay({
  activeTarget,
  open,
  stage,
  onOpenChange,
  onSelectTest,
}: RegexTesterOverlayProps) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Portal container={activeTarget.container}>
        <PopoverPrimitive.Positioner
          anchor={activeTarget.anchor}
          side="bottom"
          align="start"
          sideOffset={6}
          className="isolate z-50"
        >
          <PopoverPrimitive.Popup
            aria-label="Regex tester"
            // When portaled into a fullscreen overlay, the popup sits
            // beside the overlay's content wrapper — without this, every
            // click inside it reaches the overlay root's own
            // click-to-close handler and exits fullscreen.
            onClick={(event) => event.stopPropagation()}
            className={cn(
              "z-50 origin-(--transform-origin) rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100",
              // Enter only. The popup is unmounted the moment it closes
              // (see `useRegexTesterState`'s `handleOpenChange`), so
              // `data-closed:*` exit utilities would never match — they were
              // dead code.
              "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
            )}
          >
            {stage === "menu" ? (
              <RegexTesterMenu onSelectTest={onSelectTest} />
            ) : (
              <RegexTesterPanel
                pattern={activeTarget.pattern}
                flags={activeTarget.flags}
              />
            )}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export const RegexTesterProvider = ({
  children,
  resolveOverlayContainer,
}: {
  children: ReactNode;
  resolveOverlayContainer: RegexTesterOverlayResolver;
}) => {
  const {
    activeTarget,
    open,
    stage,
    handleClick,
    handleOpenChange,
    startTest,
  } = useRegexTesterState(resolveOverlayContainer);

  return (
    // Delegation only — interaction and keyboard semantics live on the token
    // elements themselves, so this wrapper needs no role of its own. Capture
    // phase, because Streamdown's fullscreen overlays stop bubble-phase
    // clicks inside themselves (their outside-click-closes handler), which
    // would silence tokens rendered in fullscreen; React capture still spans
    // portaled children, so scoping stays per-provider.
    <div style={{ display: "contents" }} onClickCapture={handleClick}>
      {children}
      {activeTarget ? (
        <RegexTesterOverlay
          activeTarget={activeTarget}
          open={open}
          stage={stage}
          onOpenChange={handleOpenChange}
          onSelectTest={startTest}
        />
      ) : null}
    </div>
  );
};
