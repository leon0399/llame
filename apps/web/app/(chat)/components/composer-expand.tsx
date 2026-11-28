"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Maximize2Icon, Minimize2Icon } from "lucide-react";

import {
  useShortcut,
  useShortcutHint,
} from "@/lib/shortcuts/shortcuts-context";

import { ComposerTooltip } from "./composer-tooltip";
import { PromptInputButton } from "./prompt-input";

/*
 * Room for a long message: the composer grows in place to most of the
 * viewport, so attachments, the model and Send stay where they are, as
 * ChatGPT's expand does, instead of moving the draft into a modal.
 */

/** Past this the message is long enough that the toggle is offered. */
const LONG_MESSAGE_CHARS = 280;
const LONG_MESSAGE_LINES = 5;

function isLongMessage(input: string): boolean {
  return (
    input.length > LONG_MESSAGE_CHARS ||
    input.split("\n").length > LONG_MESSAGE_LINES
  );
}

/** Most of what the viewport shows, which on a phone with its keyboard open
 *  is the visual viewport, measured when the composer expands. */
function expandedComposerHeight(): number {
  const viewport = window.visualViewport?.height ?? window.innerHeight;

  return Math.round(viewport * 0.55);
}

export type ComposerExpand = {
  /** The fixed textarea height while expanded; undefined at rest. */
  height: number | undefined;
  toggle: () => void;
  /** Wraps the form's submit: a sent message returns to the resting size. */
  collapseAfter: (
    onSubmit: (event: FormEvent<HTMLFormElement>) => void,
  ) => (event: FormEvent<HTMLFormElement>) => void;
};

/** Plays a height change the auto-resize hook already applied, from the
 *  height measured before it, so the field grows and shrinks rather than
 *  jumping. Skipped for reduced motion. */
function playHeightChange(field: HTMLTextAreaElement, from: number) {
  const to = field.offsetHeight;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduce || from === to) return;

  field.animate(
    [{ height: `${String(from)}px` }, { height: `${String(to)}px` }],
    {
      duration: 200,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    },
  );
}

/** The expand state, and its shortcut while the composer is usable. `area`
 *  holds the message field, whose height change is animated. */
export function useComposerExpand(
  enabled: boolean,
  area: RefObject<HTMLElement | null>,
): ComposerExpand {
  const [height, setHeight] = useState<number | undefined>(undefined);
  // The field's height before a change, played once the change lands.
  const fromRef = useRef<number | null>(null);

  const field = () => area.current?.querySelector("textarea") ?? null;

  const change = (
    next: (current: number | undefined) => number | undefined,
  ) => {
    fromRef.current = field()?.offsetHeight ?? null;
    setHeight(next);
  };

  // Runs after the textarea's own resize, which is a layout effect too.
  useLayoutEffect(() => {
    const from = fromRef.current;
    const element = field();

    fromRef.current = null;

    if (from !== null && element !== null) playHeightChange(element, from);
  });

  const toggle = () =>
    change((current) =>
      current === undefined ? expandedComposerHeight() : undefined,
    );

  useShortcut("composer.expand", toggle, enabled);

  return {
    height,
    toggle,
    collapseAfter: (onSubmit) => (event) => {
      change(() => undefined);
      onSubmit(event);
    },
  };
}

/** The toggle in the input's top-right corner: shown once the message is
 *  long, or while expanded; the shortcut works at any length. Its slot is
 *  always reserved (see `ComposerMessageField`), so the text never reflows
 *  when it appears. */
export function ComposerExpandToggle({
  expand,
  input,
}: {
  expand: ComposerExpand;
  input: string;
}) {
  const hint = useShortcutHint("composer.expand");
  const expanded = expand.height !== undefined;

  if (!expanded && !isLongMessage(input)) return null;

  const label = expanded ? "Collapse the composer" : "Expand the composer";

  return (
    <ComposerTooltip
      label={label}
      shortcut={hint.label}
      render={
        <PromptInputButton
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={expanded}
          aria-keyshortcuts={hint.aria}
          onClick={expand.toggle}
        />
      }
    >
      {expanded ? <Minimize2Icon aria-hidden /> : <Maximize2Icon aria-hidden />}
    </ComposerTooltip>
  );
}
