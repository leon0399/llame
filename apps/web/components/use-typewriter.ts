"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

// Read from the platform rather than a motion library: `apps/web` declares
// framer-motion but imports it nowhere, and this needs one boolean. The rest
// of the app expresses the same preference through Tailwind's `motion-reduce:`
// variant, which is this media query.
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const subscribeToReducedMotion = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

const prefersReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;

/** Server-rendered markup animates nothing, so it starts from "no preference". */
const prefersReducedMotionOnServer = () => false;

/**
 * Per-character rates, and the ceilings that keep a long title from crawling.
 * Deleting is the faster half on purpose: it is the part the reader already
 * knows, so it clears out of the way rather than being read again.
 */
const DELETE = { PER_CHAR_MS: 15, TOTAL_MS: 350 };
const TYPE = { PER_CHAR_MS: 30, TOTAL_MS: 1200 };

const step = (rate: { PER_CHAR_MS: number; TOTAL_MS: number }, chars: number) =>
  Math.min(rate.PER_CHAR_MS, rate.TOTAL_MS / Math.max(chars, 1));

/** Code-point characters — never UTF-16 code units (emoji surrogates). */
const charsOf = (value: string): Array<string> => Array.from(value);

/** How many leading code points `a` and `b` share. */
export function sharedPrefixLength(a: string, b: string): number {
  const left = charsOf(a);
  const right = charsOf(b);
  const limit = Math.min(left.length, right.length);
  let i = 0;
  while (i < limit && left[i] === right[i]) i += 1;
  return i;
}

type TypewriterPhase = "delete" | "type";
type TypewriterFrame = {
  text: string;
  phase: TypewriterPhase;
  delayMs: number;
};

/**
 * Pure: the next frame toward `target` given the current `display` and
 * `phase`, or `null` once nothing is left to animate. Deletion completing
 * and typing starting can happen within the same frame — mirrors the
 * original inline state machine's fall-through, just without the mutation.
 */
function nextTypewriterFrame(
  display: string,
  target: string,
  phase: TypewriterPhase,
): TypewriterFrame | null {
  const currentChars = charsOf(display);
  const goalChars = charsOf(target);
  const prefixLen = sharedPrefixLength(display, target);

  if (phase === "delete" && currentChars.length > prefixLen) {
    return {
      text: currentChars.slice(0, -1).join(""),
      phase: "delete",
      delayMs: step(DELETE, currentChars.length - prefixLen),
    };
  }

  if (currentChars.length < goalChars.length) {
    return {
      text: goalChars.slice(0, currentChars.length + 1).join(""),
      phase: "type",
      delayMs: step(TYPE, goalChars.length - prefixLen),
    };
  }

  return null;
}

/**
 * Drives one retype run toward `target`, or settles immediately when
 * animation is off/unnecessary. Returns the effect's cleanup, or `undefined`
 * when nothing was scheduled.
 */
function runTypewriterAnimation(
  target: string,
  previous: string,
  animates: boolean,
  refs: {
    targetRef: RefObject<string>;
    displayRef: RefObject<string>;
    setDisplay: (value: string) => void;
  },
): (() => void) | undefined {
  const { targetRef, displayRef, setDisplay } = refs;
  targetRef.current = target;

  const settle = () => {
    displayRef.current = target;
    setDisplay(target);
  };

  // Nothing to replace on the first value, and nothing to animate for a
  // re-render that did not change the title.
  if (!animates || target === previous) {
    if (displayRef.current !== target) settle();
    return undefined;
  }

  let timer: ReturnType<typeof setTimeout>;
  // Explicit, because "shorter than the goal" cannot tell deleting from
  // typing — mid-delete the text is shorter too, and the two branches would
  // hand off to each other forever.
  let phase: TypewriterPhase = "delete";

  // Re-reads `targetRef` each tick: a title arriving mid-run redirects this
  // chain rather than starting a competing one.
  const tick = () => {
    const frame = nextTypewriterFrame(
      displayRef.current,
      targetRef.current,
      phase,
    );
    if (!frame) return;
    displayRef.current = frame.text;
    setDisplay(frame.text);
    phase = frame.phase;
    timer = setTimeout(tick, frame.delayMs);
  };

  tick();
  return () => clearTimeout(timer);
}

/**
 * useTypewriter returns the text to render for `target`, retyping it whenever
 * `target` changes: the old text is deleted down to the largest common prefix
 * with the new one, then the remainder typed in. It animates a change to
 * something already on screen — a chat that just earned a generated name, a
 * rename landing from elsewhere — so the name reads as authored rather than
 * swapped. The first value is never animated; there is nothing to replace yet.
 *
 * Returns `target` verbatim, with no timers, under `prefers-reduced-motion`.
 *
 * @summary the display text for a title that retypes itself when it changes
 */
export function useTypewriter(
  target: string,
  { enabled = true }: { enabled?: boolean } = {},
): string {
  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    prefersReducedMotion,
    prefersReducedMotionOnServer,
  );
  const animates = enabled && !reducedMotion;

  const [display, setDisplay] = useState(target);
  // What the caller last asked for, so the effect can tell an actual change
  // from a re-render, and the first value from a replacement. Also read inside
  // the timer chain, so a change arriving mid-animation redirects the run in
  // flight instead of racing a second one.
  const targetRef = useRef(target);
  const displayRef = useRef(target);

  useEffect(
    () =>
      runTypewriterAnimation(target, targetRef.current, animates, {
        targetRef,
        displayRef,
        setDisplay,
      }),
    [target, animates],
  );

  return display;
}
