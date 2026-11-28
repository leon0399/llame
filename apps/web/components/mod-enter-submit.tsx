"use client";

import type { KeyboardEvent } from "react";

import { Kbd } from "@workspace/ui/components/kbd";
import { usePrimaryModifierKey } from "@workspace/ui/hooks/use-modifier-key";

/*
 * One rule for every form outside the composer: Enter in a single-line field
 * submits, Enter in a multi-line field inserts a newline, and Ctrl/⌘+Enter
 * submits from anywhere in the form. The primary action names the shortcut.
 */

/** A keydown handler that submits on Ctrl/⌘+Enter. Enter that confirms an
 *  IME composition is not a submit. It stops the key there, so a form can
 *  bind it in the capture phase (`onKeyDownCapture`) and submit before a
 *  control inside acts on the Enter itself, such as a switch toggling. */
export function submitOnModEnter(onSubmit: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      onSubmit();
    }
  };
}

/** A keydown handler that submits on Enter, for a single-line field. */
export function submitOnEnter(onSubmit: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Enter") {
      event.preventDefault();
      onSubmit();
    }
  };
}

/** The `aria-keyshortcuts` value for the primary action. */
export function useModEnterAria(): string {
  return `${usePrimaryModifierKey() === "⌘" ? "Meta" : "Control"}+Enter`;
}

/** The shortcut drawn inside the primary action; announced through
 *  `aria-keyshortcuts`, not the button's name. */
export function ModEnterKbd() {
  const modifierKey = usePrimaryModifierKey();

  return (
    <Kbd aria-hidden="true">
      {modifierKey}
      <span>↵</span>
    </Kbd>
  );
}
