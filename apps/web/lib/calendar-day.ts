/*
 * What kind of moment a local date and hour is, for copy that changes with
 * it (the new-chat greeting, the thinking verbs): its slot of the day and
 * the special day it may be.
 */

export type Slot =
  | "night"
  | "early"
  | "morning"
  | "afternoon"
  | "evening"
  | "late";

/** Each slot runs until this local hour (exclusive), in order. */
const SLOT_ENDS: ReadonlyArray<readonly [Slot, number]> = [
  ["night", 5],
  ["early", 9],
  ["morning", 12],
  ["afternoon", 18],
  ["evening", 22],
  ["late", 24],
];

export function slotOf(hour: number): Slot {
  return (SLOT_ENDS.find(([, end]) => hour < end) ?? SLOT_ENDS[0])[0];
}

export type SpecialDayId =
  | "new-year"
  | "groundhog"
  | "valentine"
  | "leap-day"
  | "womens-day"
  | "pi-day"
  | "april-fools"
  | "earth-day"
  | "star-wars"
  | "towel-day"
  | "pirate"
  | "hobbit"
  | "back-to-the-future"
  | "caps-lock"
  | "mole-day"
  | "halloween"
  | "christmas-eve"
  | "christmas"
  | "new-years-eve"
  | "equinox"
  | "solstice"
  | "clocks-forward"
  | "clocks-back"
  | "unix-milestone"
  | "programmers-day"
  | "friday-13";

export type SpecialDay = {
  id: SpecialDayId;
  /** On a Unix-time milestone, the round number of seconds it passes. */
  milestone?: number;
};

/** Special days by calendar date, `MM-DD`. Solstices and equinoxes use the
 *  day they most often fall; the true date drifts by a day across years and
 *  time zones. */
const BY_DATE = new Map<string, SpecialDayId>([
  ["01-01", "new-year"],
  ["02-02", "groundhog"],
  ["02-14", "valentine"],
  ["02-29", "leap-day"],
  ["03-08", "womens-day"],
  ["03-14", "pi-day"],
  ["03-20", "equinox"],
  ["04-01", "april-fools"],
  ["04-22", "earth-day"],
  ["05-04", "star-wars"],
  ["05-25", "towel-day"],
  ["06-21", "solstice"],
  ["09-19", "pirate"],
  ["09-22", "hobbit"],
  ["09-23", "equinox"],
  ["10-21", "back-to-the-future"],
  ["10-22", "caps-lock"],
  ["10-23", "mole-day"],
  ["10-31", "halloween"],
  ["12-21", "solstice"],
  ["12-24", "christmas-eve"],
  ["12-25", "christmas"],
  ["12-31", "new-years-eve"],
]);

const DAY_MS = 86_400_000;

function monthDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${month}-${day}`;
}

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0, date.getHours());

  // Whole local days; rounding absorbs a daylight-saving hour in between.
  return Math.round((date.getTime() - start.getTime()) / DAY_MS);
}

/** The local day's clock change, if it has one: the offset at its first and
 *  last hour differ. A smaller offset means the clocks went forward. */
function clockChange(date: Date): "forward" | "back" | null {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  const first = new Date(y, m, d, 0).getTimezoneOffset();
  const last = new Date(y, m, d, 23).getTimezoneOffset();

  if (first === last) return null;

  return last < first ? "forward" : "back";
}

/** A Unix-time round number (a multiple of 100,000,000 seconds) that the
 *  local day passes, if any. */
function unixMilestone(date: Date): number | null {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const from = start.getTime() / 1000;
  const next = Math.ceil(from / 1e8) * 1e8;

  return next < from + DAY_MS / 1000 ? next : null;
}

/** The special day a local date is, if any, rarest event first. */
export function specialDayOf(date: Date): SpecialDay | null {
  const change = clockChange(date);

  if (change !== null) {
    return { id: change === "forward" ? "clocks-forward" : "clocks-back" };
  }

  const milestone = unixMilestone(date);

  if (milestone !== null) return { id: "unix-milestone", milestone };

  if (dayOfYear(date) === 256) return { id: "programmers-day" };

  if (date.getDay() === 5 && date.getDate() === 13) return { id: "friday-13" };

  const id = BY_DATE.get(monthDay(date));

  return id === undefined ? null : { id };
}
