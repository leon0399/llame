/**
 * Per-chat activity indicator: a small badge on the bottom-right of the chat
 * icon in the sidebar row, per the authoritative design
 * (`chatStatusEl`/`ll-status-dot` in the double-sidebar mock). Three states
 * are designed — `unread`, `processing`, `needs-input` — but only the first
 * two have a backend signal today:
 *
 * - `processing`: a run is currently tracked (non-terminal) for this chat —
 *   `ActiveRunsProvider`'s `activeChatIds`.
 * - `unread`: a run for this chat completed while the user was elsewhere —
 *   `ActiveRunsProvider`'s `completedChats`.
 * - `needs-input` (an approval/confirmation the agent is waiting on) has NO
 *   backend state yet — that's future policy/approval-flow territory (#45).
 *   Deliberately not faked: `resolveChatActivityStatus` never produces it, so
 *   this component simply never renders that variant until a real signal
 *   exists to drive it.
 *
 * Supersedes the plain unseen-reply dot this feature originally shipped
 * (rendered inline next to the title) — this is a design upgrade, not an
 * addition alongside it.
 */
export type ChatActivityStatus = "unread" | "processing";

export function resolveChatActivityStatus(input: {
  processing: boolean;
  unread: boolean;
}): ChatActivityStatus | null {
  // A chat that's actively generating a reply isn't "unread" yet — there's
  // nothing to read. processing takes precedence over unread.
  if (input.processing) return "processing";
  if (input.unread) return "unread";
  return null;
}

// Shared position/size/separator, matching the design's chatStatusEl `base`
// style exactly (absolute, bottom -3px, right -4px, 9px circle, a 2px
// background-colored ring so the badge reads as separate from the icon
// behind it).
const BADGE_BASE =
  "absolute -right-1 -bottom-[3px] size-[9px] rounded-full shadow-[0_0_0_2px_var(--sidebar)]";

export function ChatActivityIndicator({
  status,
}: {
  status: ChatActivityStatus | null;
}) {
  if (status === "processing") {
    // Achromatic spinner ring (background/border/muted-foreground are all
    // already-sanctioned DESIGN.md tokens) — no color judgment call needed
    // here, unlike `unread` below.
    return (
      <span
        aria-label="Generating response"
        className={`${BADGE_BASE} animate-spin border-[1.5px] border-border border-t-muted-foreground bg-background`}
      />
    );
  }
  if (status === "unread") {
    // Judgment call: the design's mock renders this dot in a hardcoded blue
    // (#3b82f6), but DESIGN.md §2 makes `--destructive` (red, danger-only)
    // the system's ONLY standing chromatic color outside the chart ramp, and
    // its Don'ts explicitly forbid borrowing chart colors or introducing an
    // ad-hoc hue for UI accents. Red would be semantically wrong here (an
    // unread reply isn't an error), and chart colors are reserved for data
    // viz. Mapped to `--primary` (Ink) instead — solid, achromatic, and the
    // same token this feature's original unseen-dot already used — matching
    // the design's shape/position but not its one-off color.
    return (
      <span aria-label="Unread reply" className={`${BADGE_BASE} bg-primary`} />
    );
  }
  return null;
}
