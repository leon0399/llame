/*
 * The new-chat greeting. The day splits into hour slots; each slot has a few
 * lines for any day, the weekday adds its own (weekends read differently
 * from workdays), and a handful of dates replace the lot. One line is drawn
 * per visit. `{name}` marks the owner's name, always written ", {name}", so
 * an owner with no name gets the line without it.
 */

type Slot = "night" | "early" | "morning" | "afternoon" | "evening" | "late";

/** Each slot runs until this local hour (exclusive), in order. */
const SLOT_ENDS: ReadonlyArray<readonly [Slot, number]> = [
  ["night", 5],
  ["early", 9],
  ["morning", 12],
  ["afternoon", 18],
  ["evening", 22],
  ["late", 24],
];

type Lines = Partial<Record<Slot, ReadonlyArray<string>>>;

/** Lines for any day. "Good night" is a farewell, so late hours never say it. */
const ANY_DAY = {
  night: [
    "Hello, night owl",
    "Up late, {name}?",
    "Moonlit chat?",
    "The quiet hours, {name}",
    "Can't sleep, {name}?",
  ],
  early: [
    "Hey, early bird",
    "Good morning, {name}",
    "Coffee and a plan?",
    "Up with the sun, {name}?",
  ],
  morning: [
    "Good morning, {name}",
    "Welcome, {name}",
    "What's cooking, {name}?",
    "Where should we start, {name}?",
    "What are we thinking about, {name}?",
  ],
  afternoon: [
    "Good afternoon, {name}",
    "Afternoon, {name}",
    "Back at it, {name}",
    "Let's noodle",
    "What's on your mind, {name}?",
  ],
  evening: [
    "Good evening, {name}",
    "Evening, {name}",
    "Evening thoughts",
    "Evening, how are things?",
    "What are we building tonight?",
  ],
  late: [
    "Hello, night owl",
    "Up late, {name}?",
    "It's a late-night jam session",
    "Burning the midnight oil, {name}?",
  ],
} satisfies Record<Slot, ReadonlyArray<string>>;

const WEEKEND: Lines = {
  early: ["Slow morning, {name}?"],
  morning: ["Welcome to the weekend, {name}", "No rush today, {name}"],
  afternoon: ["Weekend project, {name}?", "Tinkering time?"],
  evening: ["Weekend evening, {name}"],
};

/** Lines a weekday adds to the slot's pool, 0 being Sunday. */
const BY_WEEKDAY: ReadonlyArray<Lines> = [
  { ...WEEKEND, morning: ["Happy Sunday, {name}", "Sunday project, {name}?"] },
  {
    early: ["Happy Monday, {name}"],
    morning: ["Happy Monday, {name}", "New week, {name}. Where to?"],
  },
  { morning: ["Happy Tuesday, {name}"] },
  {
    morning: ["Midweek already, {name}"],
    afternoon: ["Over the hump, {name}"],
  },
  { early: ["Happy Thursday, {name}"], morning: ["Happy Thursday, {name}"] },
  {
    morning: ["Happy Friday, {name}"],
    afternoon: ["Almost the weekend, {name}", "Friday wind-down?"],
    evening: ["Friday night build?"],
  },
  {
    ...WEEKEND,
    morning: ["Happy Saturday, {name}", "Welcome to the weekend, {name}"],
  },
];

/** Lines for a calendar date, `MM-DD`, which replace the slots that day. */
const BY_DATE = new Map<string, ReadonlyArray<string>>([
  ["01-01", ["Happy New Year, {name}", "Fresh year, {name}. Where to?"]],
  ["02-14", ["Happy Valentine's Day, {name}"]],
  ["02-29", ["A leap day, {name}. Make it count"]],
  ["03-08", ["Happy Women's Day, {name}"]],
  ["03-14", ["Happy Pi Day, {name}"]],
  ["04-01", ["No pranks today, {name}. Mostly"]],
  ["04-22", ["Happy Earth Day, {name}"]],
  ["05-04", ["May the Fourth be with you, {name}"]],
  ["05-25", ["Happy Towel Day, {name}. Don't panic"]],
  ["10-31", ["Happy Halloween, {name}", "Spooky season, {name}?"]],
  ["12-24", ["Merry Christmas Eve, {name}"]],
  ["12-25", ["Merry Christmas, {name}", "Happy holidays, {name}"]],
  ["12-31", ["Last one of the year, {name}?", "Wrapping up the year, {name}?"]],
]);

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0, date.getHours());

  // Whole local days; rounding absorbs a daylight-saving hour in between.
  return Math.round((date.getTime() - start.getTime()) / 86_400_000);
}

/** The special lines for a date, if it has any: the table above, Friday the
 *  13th, and Programmers' Day, the year's 256th day. */
function dateLines(date: Date): ReadonlyArray<string> | undefined {
  if (dayOfYear(date) === 256) return ["Happy Programmers' Day, {name}"];

  if (date.getDay() === 5 && date.getDate() === 13) {
    return ["Friday the 13th, {name}. Nothing to fear"];
  }

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return BY_DATE.get(`${month}-${day}`);
}

function slotOf(hour: number): Slot {
  return (SLOT_ENDS.find(([, end]) => hour < end) ?? SLOT_ENDS[0])[0];
}

/** The lines a greeting is drawn from at a local date and time. */
export function greetingLines(date: Date): ReadonlyArray<string> {
  const special = dateLines(date);

  if (special) return special;

  const slot = slotOf(date.getHours());

  return [...ANY_DAY[slot], ...(BY_WEEKDAY[date.getDay()][slot] ?? [])];
}

/** The new-chat page's greeting at a local date and time, for the name the
 *  owner asked to be called, if any. `roll` in [0, 1) picks the line, so a
 *  caller rolls once per visit and the line holds while the page is open. */
export function greeting(
  date: Date,
  name: string | null,
  roll: number,
): string {
  const lines = greetingLines(date);
  const line = lines[Math.floor(roll * lines.length) % lines.length];

  return name === null
    ? line.replace(", {name}", "")
    : line.replace("{name}", name);
}

/** The name to greet: the preferred name from personalization, else the first
 *  word of the account name, else none. Blank values count as absent. */
export function greetingName(
  preferredName: string | null | undefined,
  accountName: string | null | undefined,
): string | null {
  const preferred = preferredName?.trim();

  if (preferred) return preferred;

  const first = accountName?.trim().split(/\s+/)[0];

  return first ? first : null;
}
