import { useCallback, useEffect, useRef, useState } from "react";

import { equalJitterDelayMs } from "@/lib/equal-jitter";

// Re-attaching an interrupted Run's stream (#1284).
//
// The mount probe in `useChatHistorySync` cannot cover an interruption that
// happens after mount — the second and later turns of a conversation, and any
// hours-long Run interrupted by a suspend, a deploy, or a network change —
// because it has already run for this page. This module owns that repair
// episode: the first attempt is immediate, consecutive failures wait an
// equal-jitter delay, and after `STREAM_REPAIR_MAX_ATTEMPTS` failures the Run
// is handed to the durable path (the tracked Run's completion refreshes the
// transcript). `healthy` resets the count, so an interruption of a Run whose
// stream was flowing starts from zero rather than from an accumulated backoff.

/** Consecutive failed re-attaches before the durable path takes the Run. */
export const STREAM_REPAIR_MAX_ATTEMPTS = 5;

/** One interruption, with a fresh `seq` per event: a Run interrupted again
 *  after a failed re-attach must re-run the repair, and an equal state value
 *  would be ignored. */
export type StreamInterruption = { runId: string; seq: number };

type RepairEpisode = {
  runId: string;
  seq: number;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
};

/** The wait before the next attempt: none for the first, equal-jitter after. */
export function streamRepairDelayMs(attempts: number): number {
  return attempts === 0 ? 0 : equalJitterDelayMs(attempts - 1);
}

/** The episode an interruption continues, or a fresh one for another Run. */
function mergeEpisode(
  held: RepairEpisode | null,
  interruption: StreamInterruption,
): RepairEpisode {
  const episode =
    held && held.runId === interruption.runId
      ? held
      : { runId: interruption.runId, seq: 0, attempts: 0, timer: null };
  episode.seq = interruption.seq;
  if (episode.timer !== null) {
    clearTimeout(episode.timer);
    episode.timer = null;
  }
  return episode;
}

/** Spends one attempt of the episode: attaches now, or schedules the wait. */
function spendAttempt(
  episode: RepairEpisode,
  attach: () => void,
  onAttempt: () => void,
): void {
  if (episode.attempts >= STREAM_REPAIR_MAX_ATTEMPTS) return;
  const delayMs = streamRepairDelayMs(episode.attempts);
  episode.attempts += 1;
  onAttempt();
  if (delayMs === 0) {
    attach();
    return;
  }
  episode.timer = setTimeout(attach, delayMs);
}

/**
 * The interruption a stream reported, and the reporter `onStreamInterrupted`
 * wires into the engine. A fresh `seq` per event is what makes a Run
 * interrupted *again* re-run the repair: an equal state value is ignored.
 */
export function useStreamInterruption() {
  const [interruption, setInterruption] = useState<StreamInterruption | null>(
    null,
  );
  const report = useCallback((runId: string | null) => {
    if (!runId) return;
    setInterruption((previous) => ({
      runId,
      seq: (previous?.seq ?? 0) + 1,
    }));
  }, []);
  return { interruption, report };
}

export function useStreamRepair(options: {
  attach: () => void;
  interruption: StreamInterruption | null;
  /** True while the Run's stream is delivering events. */
  healthy: boolean;
  /** Runs before each attempt (the mount probe claims the same attach slot). */
  onAttempt: () => void;
}): void {
  const { attach, interruption, healthy, onAttempt } = options;
  const episodeRef = useRef<RepairEpisode | null>(null);

  useEffect(() => {
    if (!interruption || episodeRef.current?.seq === interruption.seq) return;
    const episode = mergeEpisode(episodeRef.current, interruption);
    episodeRef.current = episode;
    spendAttempt(episode, attach, onAttempt);
  }, [interruption, attach, onAttempt]);

  useEffect(() => {
    if (!healthy || !episodeRef.current) return;
    episodeRef.current.attempts = 0;
  }, [healthy]);

  useEffect(
    () => () => {
      const episode = episodeRef.current;
      if (episode?.timer != null) clearTimeout(episode.timer);
    },
    [],
  );
}
