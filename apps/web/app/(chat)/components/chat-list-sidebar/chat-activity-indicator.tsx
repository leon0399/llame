import type { RunPhase } from "@/lib/services/live/live-messages";

/**
 * Per-chat activity indicator: a small badge on the bottom-right of the chat
 * icon in the sidebar row, per the authoritative design
 * (`chatStatusEl`/`ll-status-dot` in the double-sidebar mock). The design
 * also has `needs-input`, which has no backend signal yet (#45) and is not
 * faked here.
 *
 * - `processing`: a run is currently tracked (non-terminal) for this chat —
 *   `ActiveRunsProvider`'s `activeChatIds`.
 * - `failed`: a run for this chat failed or expired while the user was
 *   elsewhere — a `failed` entry in `completedChats`.
 * - `unread`: a run for this chat completed while the user was elsewhere —
 *   a `completed` entry in `completedChats`.
 */
export type ChatActivityStatus = "unread" | "failed" | "processing";

export function resolveChatActivityStatus(input: {
  processing: boolean;
  outcome: "completed" | "failed" | undefined;
}): ChatActivityStatus | null {
  // A chat that's actively generating a reply has no outcome to show yet —
  // processing takes precedence over an earlier run's unseen result.
  if (input.processing) return "processing";
  if (input.outcome === "failed") return "failed";
  if (input.outcome === "completed") return "unread";
  return null;
}

// Shared position/size/separator, matching the design's chatStatusEl `base`
// style exactly (absolute, bottom -3px, right -4px, 9px circle, a 2px
// background-colored ring so the badge reads as separate from the icon
// behind it).
const BADGE_BASE =
  "absolute -right-1 -bottom-0.75 size-2.25 rounded-full ring-2 ring-sidebar";

/** Accessible label for a processing chat; the live run phase, when known,
 *  refines it without changing its stable "Generating response" prefix. */
export function processingLabel(phase: RunPhase | undefined): string {
  const base = "Generating response";
  switch (phase) {
    case "queued":
      return `${base}: queued`;
    case "thinking":
      return `${base}: thinking`;
    case "tool":
      return `${base}: using a tool`;
    case "writing":
      return `${base}: writing`;
    default:
      return base;
  }
}

export function ChatActivityIndicator({
  status,
  phase,
}: {
  status: ChatActivityStatus | null;
  /** Live run phase, when the live socket supplies one. */
  phase?: RunPhase;
}) {
  if (status === "processing") {
    // Achromatic spinner ring (background/border/muted-foreground are all
    // already-sanctioned DESIGN.md tokens) — no color judgment call needed
    // here, unlike `unread` below.
    return (
      // <output> (not a bare span): aria-label is prohibited on a span with
      // no role (axe aria-prohibited-attr), and output carries role=status
      // natively — this badge IS a live status.
      <output
        aria-label={processingLabel(phase)}
        title={processingLabel(phase)}
        className={`${BADGE_BASE} animate-spin border-2 border-border border-t-muted-foreground bg-background`}
      />
    );
  }
  if (status === "failed") {
    return (
      <output
        aria-label="Run failed"
        title="Run failed"
        className={`${BADGE_BASE} bg-destructive`}
      />
    );
  }
  if (status === "unread") {
    // The design's blue (#3b82f6), as the semantic `info` token.
    return (
      <output
        aria-label="Unread reply"
        title="Unread reply"
        className={`${BADGE_BASE} bg-info`}
      />
    );
  }
  return null;
}
