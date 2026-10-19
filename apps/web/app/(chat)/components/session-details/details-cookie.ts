import { z } from "zod";

/** Remembers the desktop session details sidebar's last state; the chat
 *  layout reads it on the server, so it lives outside the client-only state
 *  module. */
export const SESSION_DETAILS_COOKIE = "session_details";

/** Remembers the sections' order and which are collapsed, read on the server
 *  so the sidebar renders as it was left. */
export const SESSION_DETAILS_LAYOUT_COOKIE = "session_details_layout";

export const SESSION_DETAILS_SECTIONS = [
  "environment",
  "context",
  "changes",
] as const;

export type SessionDetailsSectionId = (typeof SESSION_DETAILS_SECTIONS)[number];

export interface SessionDetailsLayout {
  order: Array<SessionDetailsSectionId>;
  collapsed: Array<SessionDetailsSectionId>;
}

/** The cookie as written: two lists of ids, still to be checked against the
 *  sections that exist now. */
const storedLayout = z.object({
  order: z.array(z.string()),
  collapsed: z.array(z.string()),
});

type StoredLayout = z.infer<typeof storedLayout>;

const EMPTY_LAYOUT: StoredLayout = { order: [], collapsed: [] };

function isSectionId(value: string): value is SessionDetailsSectionId {
  return SESSION_DETAILS_SECTIONS.some((id) => id === value);
}

function sectionIds(values: Array<string>): Array<SessionDetailsSectionId> {
  return [...new Set(values.filter(isSectionId))];
}

function readStoredLayout(raw: string | undefined): StoredLayout {
  if (raw === undefined) return EMPTY_LAYOUT;
  try {
    const result = storedLayout.safeParse(JSON.parse(raw));
    return result.success ? result.data : EMPTY_LAYOUT;
  } catch {
    return EMPTY_LAYOUT;
  }
}

/**
 * The stored layout, or the default for a missing or unreadable cookie. A
 * section the cookie does not know (added since it was written) joins at the
 * end; an id it names that no longer exists is dropped.
 */
export function parseSessionDetailsLayout(
  raw: string | undefined,
): SessionDetailsLayout {
  const stored = readStoredLayout(raw);
  const order = sectionIds(stored.order);
  const missing = SESSION_DETAILS_SECTIONS.filter((id) => !order.includes(id));
  return {
    order: [...order, ...missing],
    collapsed: sectionIds(stored.collapsed),
  };
}
