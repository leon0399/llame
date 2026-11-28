"use client";

import { useState, type FormEvent } from "react";
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

/** The expand state, and its shortcut while the composer is usable. */
export function useComposerExpand(enabled: boolean): ComposerExpand {
  const [height, setHeight] = useState<number | undefined>(undefined);

  const toggle = () =>
    setHeight((current) =>
      current === undefined ? expandedComposerHeight() : undefined,
    );

  useShortcut("composer.expand", toggle, enabled);

  return {
    height,
    toggle,
    collapseAfter: (onSubmit) => (event) => {
      setHeight(undefined);
      onSubmit(event);
    },
  };
}

/** The toolbar toggle beside Send: shown once the message is long, or while
 *  expanded; the shortcut works at any length. */
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
          size="icon"
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
