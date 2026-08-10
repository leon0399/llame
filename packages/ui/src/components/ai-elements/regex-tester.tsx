"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { CheckIcon, RegexIcon } from "lucide-react";
import type {
  ComponentProps,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  UIEvent,
} from "react";
import { Children, isValidElement, useMemo, useRef, useState } from "react";
import { defaultRemarkPlugins, Streamdown } from "streamdown";

import {
  REGEX_TOKEN_TAG,
  regexTokenAllowedTags,
  remarkRegexTokens,
} from "@workspace/ui/components/ai-elements/regex-streamdown";
import {
  evaluateRegex,
  findRegexCandidates,
  splitBySpans,
} from "@workspace/ui/lib/regex-detect";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The interactive half of the message regex tester (see
 * `regex-streamdown.ts` for how tokens get into the markdown output). Any
 * descendant carrying `data-regex-token="/pattern/flags"` becomes a target:
 * clicking it opens a floating single-option menu ("Test regex") anchored to
 * it, which morphs into a live tester input, matching Linear's interaction.
 */

const extractText = (children: ReactNode): string => {
  let text = "";

  for (const child of Children.toArray(children)) {
    if (typeof child === "string" || typeof child === "number") {
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
export const RegexProseToken = ({
  children,
}: Record<string, unknown> & { children?: ReactNode }) => (
  <span
    // A native <button> is unusable here — see the JSDoc above.
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
    role="button"
    tabIndex={0}
    data-regex-token={extractText(children)}
    onKeyDown={activateOnEnterOrSpace}
    className="cursor-pointer underline decoration-muted-foreground decoration-dotted decoration-1 underline-offset-3"
  >
    {children}
  </span>
);

interface RegexTesterTarget {
  anchor: HTMLElement;
  pattern: string;
  flags: string;
  /** Portal container when the anchor lives inside a same-z overlay. */
  container: HTMLElement | undefined;
}

// Full-viewport overlays Streamdown portals to `<body>` (table/mermaid
// fullscreen, `fixed inset-0 z-50`). A popover portaled to `<body>` ties
// their z-index and loses on DOM order, so it must portal into the overlay
// itself; `dialog`/`aria-modal` covers other modal hosts the same way.
const OVERLAY_SELECTOR =
  '[data-streamdown="table-fullscreen"], [aria-modal="true"], dialog';

const menuItemClassName =
  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground";

interface RegexTesterPanelProps {
  pattern: string;
  flags: string;
}

const RegexTesterPanel = ({ pattern, flags }: RegexTesterPanelProps) => {
  const [input, setInput] = useState("");
  const underlayRef = useRef<HTMLDivElement>(null);

  const result = useMemo(
    () => evaluateRegex(pattern, flags, input),
    [pattern, flags, input],
  );

  const segments = useMemo(
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

  const syncScroll = (event: UIEvent<HTMLInputElement>) => {
    if (underlayRef.current) {
      underlayRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }
  };

  return (
    <div className="w-80">
      <div className="relative">
        {/* Mirror of the input's text, purely for the highlight backgrounds:
            its glyphs are transparent and sit exactly under the input's, so
            the green marks read as highlights inside the input itself. */}
        <div
          ref={underlayRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-x-hidden rounded-t-lg py-2 pr-9 pl-3 text-sm whitespace-pre"
        >
          {segments.map((segment, index) =>
            segment.matched ? (
              <mark
                // oxlint-disable-next-line react/no-array-index-key -- order is identity here
                key={index}
                className="rounded-[3px] bg-emerald-200 text-transparent dark:bg-emerald-500/35"
              >
                {segment.text}
              </mark>
            ) : (
              // oxlint-disable-next-line react/no-array-index-key -- order is identity here
              <span key={index} className="text-transparent">
                {segment.text}
              </span>
            ),
          )}
        </div>
        <input
          // The tester exists only after an explicit user action; focus
          // follows that action, as in the reference interaction.
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onScroll={syncScroll}
          placeholder="Enter text to match…"
          aria-label="Text to match"
          maxLength={1000}
          spellCheck={false}
          className="relative w-full bg-transparent py-2 pr-9 pl-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        {result?.matched ? (
          <CheckIcon
            aria-hidden
            className="absolute top-1/2 right-3 size-4 -translate-y-1/2"
          />
        ) : null}
      </div>
      {result ? (
        <div
          aria-live="polite"
          className="flex flex-col gap-1 border-t border-border px-3 py-2 text-sm"
        >
          {result.matched ? (
            <>
              <span className="text-muted-foreground">Match</span>
              {result.values.map((value, index) => (
                // oxlint-disable-next-line react/no-array-index-key -- values may repeat
                <span key={index} className="truncate">
                  {value}
                </span>
              ))}
            </>
          ) : (
            <span className="text-muted-foreground">No match</span>
          )}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Wraps rendered message markdown, delegates clicks on
 * `[data-regex-token]` descendants (prose buttons and decorated Shiki code
 * spans alike), and hosts the single floating menu/tester popover anchored
 * to whichever token was clicked.
 */
export const RegexTesterProvider = ({ children }: { children: ReactNode }) => {
  const [target, setTarget] = useState<RegexTesterTarget | null>(null);
  const [stage, setStage] = useState<"menu" | "tester">("menu");

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const element =
      event.target instanceof Element
        ? event.target.closest("[data-regex-token]")
        : null;

    if (!(element instanceof HTMLElement)) {
      return;
    }

    const source = element.getAttribute("data-regex-token") ?? "";
    const [candidate] = findRegexCandidates(source);

    if (
      !candidate ||
      candidate.start !== 0 ||
      candidate.end !== source.length
    ) {
      return;
    }

    setStage("menu");
    setTarget({
      anchor: element,
      pattern: candidate.pattern,
      flags: candidate.flags,
      container: element.closest<HTMLElement>(OVERLAY_SELECTOR) ?? undefined,
    });
  };

  return (
    // Delegation only — interaction and keyboard semantics live on the token
    // elements themselves, so this wrapper needs no role of its own. Capture
    // phase, because Streamdown's fullscreen overlays stop bubble-phase
    // clicks inside themselves (their outside-click-closes handler), which
    // would silence tokens rendered in fullscreen; React capture still spans
    // portaled children, so scoping stays per-provider.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div style={{ display: "contents" }} onClickCapture={handleClick}>
      {children}
      {target ? (
        <PopoverPrimitive.Root
          open
          onOpenChange={(open) => {
            if (!open) {
              setTarget(null);
            }
          }}
        >
          <PopoverPrimitive.Portal container={target.container}>
            <PopoverPrimitive.Positioner
              anchor={target.anchor}
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
                  "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
                )}
              >
                {stage === "menu" ? (
                  <div role="menu" aria-label="Regex actions" className="p-1">
                    <button
                      type="button"
                      role="menuitem"
                      // Focus follows the click that opened the menu.
                      // oxlint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                      onClick={() => setStage("tester")}
                      className={menuItemClassName}
                    >
                      <RegexIcon
                        aria-hidden
                        className="size-4 text-muted-foreground"
                      />
                      Test regex
                    </button>
                  </div>
                ) : (
                  <RegexTesterPanel
                    pattern={target.pattern}
                    flags={target.flags}
                  />
                )}
              </PopoverPrimitive.Popup>
            </PopoverPrimitive.Positioner>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      ) : null}
    </div>
  );
};

/**
 * Streamdown with the regex tester fully wired: the tester provider, the
 * prose/inline-code remark pass, the `<regex-token>` component mapping, and
 * its sanitize whitelist travel together, so a call site cannot partially
 * wire the feature (an omission fails silently at runtime, not in types).
 * Caller-supplied `components`/`remarkPlugins`/`allowedTags` are merged in,
 * and the merged values are memoized: Streamdown's per-block memo compares
 * `remarkPlugins` by reference, so an array rebuilt every render would force
 * every completed block to re-parse on each streaming tick.
 */
export const RegexTesterStreamdown = ({
  components,
  remarkPlugins,
  allowedTags,
  ...props
}: ComponentProps<typeof Streamdown>) => {
  const mergedComponents = useMemo(
    () => ({ ...components, [REGEX_TOKEN_TAG]: RegexProseToken }),
    [components],
  );
  // `remarkPlugins` REPLACES Streamdown's defaults (react-markdown
  // semantics), so appending our pass must re-supply `defaultRemarkPlugins`
  // — dropping them silently turns off GFM (tables, autolinks) everywhere.
  const mergedRemarkPlugins = useMemo(() => {
    // Streamdown accepts a list or a name-keyed record (its own
    // `defaultRemarkPlugins` export is the record form); normalize either.
    const base = remarkPlugins ?? defaultRemarkPlugins;
    return [
      ...(Array.isArray(base) ? base : Object.values(base)),
      remarkRegexTokens,
    ];
  }, [remarkPlugins]);
  const mergedAllowedTags = useMemo(
    () => ({ ...allowedTags, ...regexTokenAllowedTags }),
    [allowedTags],
  );

  return (
    <RegexTesterProvider>
      <Streamdown
        {...props}
        components={mergedComponents}
        remarkPlugins={mergedRemarkPlugins}
        allowedTags={mergedAllowedTags}
      />
    </RegexTesterProvider>
  );
};
