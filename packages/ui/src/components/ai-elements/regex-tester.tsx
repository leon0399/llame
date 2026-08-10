"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { CheckIcon, RegexIcon } from "lucide-react";
import type { MouseEvent, ReactNode, UIEvent } from "react";
import { Children, isValidElement, useMemo, useRef, useState } from "react";

import {
  evaluateRegex,
  findRegexCandidates,
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

/**
 * Renders a `<regex-token>` element from the markdown pipeline as a dotted
 * underlined inline button. The visible text is the literal itself; the
 * mirror `data-regex-token` attribute is what `RegexTesterProvider`'s click
 * delegation looks for.
 */
export const RegexProseToken = ({
  children,
}: Record<string, unknown> & { children?: ReactNode }) => (
  <button
    type="button"
    data-regex-token={extractText(children)}
    className="cursor-pointer bg-transparent p-0 font-[inherit] text-inherit underline decoration-muted-foreground decoration-dotted decoration-1 underline-offset-3"
  >
    {children}
  </button>
);

interface RegexTesterTarget {
  anchor: HTMLElement;
  pattern: string;
  flags: string;
}

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

  const segments = useMemo(() => {
    if (!result) {
      return [];
    }

    const out: Array<{ text: string; matched: boolean }> = [];
    let cursor = 0;

    for (const range of result.ranges) {
      if (range.start > cursor) {
        out.push({ text: input.slice(cursor, range.start), matched: false });
      }
      out.push({ text: input.slice(range.start, range.end), matched: true });
      cursor = range.end;
    }

    if (cursor < input.length) {
      out.push({ text: input.slice(cursor), matched: false });
    }

    return out;
  }, [result, input]);

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
    });
  };

  return (
    // Delegation only — interaction and keyboard semantics live on the token
    // buttons themselves, so this wrapper needs no role of its own.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div style={{ display: "contents" }} onClick={handleClick}>
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
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Positioner
              anchor={target.anchor}
              side="bottom"
              align="start"
              sideOffset={6}
              className="isolate z-50"
            >
              <PopoverPrimitive.Popup
                aria-label="Regex tester"
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
