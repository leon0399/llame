"use client";

import { useEffect, useState } from "react";

import { drawThinkingVerb, type VerbRolls } from "@/lib/thinking-verbs";

/** How long one verb shows before the next is drawn. */
const ROTATE_MS = 6000;

const newRolls = (): VerbRolls => ({
  verb: Math.random(),
  rarity: Math.random(),
  special: Math.random(),
});

/**
 * A verb for the model at work (`lib/thinking-verbs`), redrawn every few
 * seconds while `active`. "Thinking" until mounted: the first draw is random,
 * so the server and the hydrating client must not each make one.
 */
export function useThinkingVerb(active: boolean): string {
  const [verb, setVerb] = useState("Thinking");

  useEffect(() => {
    if (!active) return;

    const draw = () => setVerb(drawThinkingVerb(new Date(), newRolls()));

    draw();
    const timer = window.setInterval(draw, ROTATE_MS);

    return () => window.clearInterval(timer);
  }, [active]);

  return verb;
}
