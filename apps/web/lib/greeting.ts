/*
 * The new-chat greeting. The day splits into hour slots; each slot has a few
 * lines for any day, the weekday adds its own (weekends read differently
 * from workdays), and special dates replace the lot: holidays, clock
 * changes, solstices, Unix-time milestones. One line is drawn per visit,
 * and now and then a rare one, 1 in 100 up to 1 in 100,000. `{name}` marks
 * the owner's name, written ", {name}" so an owner with no name gets the
 * line without it; a line that cannot drop it that way carries a nameless
 * twin.
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
  ["02-02", ["Again, {name}? Happy Groundhog Day"]],
  ["02-14", ["Happy Valentine's Day, {name}"]],
  ["02-29", ["A leap day, {name}. Make it count"]],
  ["03-08", ["Happy Women's Day, {name}"]],
  ["03-14", ["Happy Pi Day, {name}"]],
  ["04-01", ["No pranks today, {name}. Mostly"]],
  ["04-22", ["Happy Earth Day, {name}"]],
  ["05-04", ["May the Fourth be with you, {name}"]],
  ["05-25", ["Happy Towel Day, {name}. Don't panic"]],
  ["09-19", ["Ahoy, {name}! Talk Like a Pirate Day"]],
  ["09-22", ["Second breakfast, {name}? Happy Hobbit Day"]],
  ["10-21", ["Great Scott, {name}! Back to the Future Day"]],
  ["10-22", ["Happy Caps Lock Day, {name}"]],
  ["10-23", ["Happy Mole Day, {name}"]],
  ["10-31", ["Happy Halloween, {name}", "Spooky season, {name}?"]],
  ["12-24", ["Merry Christmas Eve, {name}"]],
  ["12-25", ["Merry Christmas, {name}", "Happy holidays, {name}"]],
  ["12-31", ["Last one of the year, {name}?", "Wrapping up the year, {name}?"]],
]);

/** Solstices and equinoxes, on the day they most often fall; the true date
 *  drifts by a day across years and time zones. */
const SKY_DAYS = new Map<string, string>([
  ["03-20", "Equinox today, {name}. Day and night even"],
  ["06-21", "Solstice today, {name}"],
  ["09-23", "Equinox today, {name}. Day and night even"],
  ["12-21", "Solstice today, {name}"],
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

/** The special lines for a date, if it has any, rarest event first. */
function dateLines(date: Date): ReadonlyArray<string> | undefined {
  const change = clockChange(date);

  if (change === "forward") return ["Lost an hour of sleep, {name}?"];

  if (change === "back") return ["Enjoy the extra hour, {name}"];

  const milestone = unixMilestone(date);

  if (milestone !== null) {
    return [
      `Unix time hits ${milestone.toLocaleString("en-US")} today, {name}`,
    ];
  }

  if (dayOfYear(date) === 256) return ["Happy Programmers' Day, {name}"];

  if (date.getDay() === 5 && date.getDate() === 13) {
    return ["Friday the 13th, {name}. Nothing to fear"];
  }

  const key = monthDay(date);
  const sky = SKY_DAYS.get(key);

  return BY_DATE.get(key) ?? (sky === undefined ? undefined : [sky]);
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

export type Rarity = {
  tier: "uncommon" | "rare" | "epic" | "legendary";
  /** One in this many visits. */
  odds: number;
};

/** Rare greetings, rarest first. */
const RARE: ReadonlyArray<Rarity & { lines: ReadonlyArray<string> }> = [
  {
    tier: "legendary",
    odds: 100_000,
    lines: [
      "One in a hundred thousand, {name}. Make a wish",
      "42, {name}. Now, what was the question?",
      "Legendary greeting caught. Nobody will believe you, {name}",
    ],
  },
  {
    tier: "epic",
    odds: 10_000,
    lines: [
      "The cake is not a lie, {name}",
      "Shiny greeting, {name}! One in ten thousand",
      "Insert coin to continue, {name}",
    ],
  },
  {
    tier: "rare",
    odds: 1000,
    lines: [
      "Hello, world. Hello, {name}.",
      "It's dangerous to go alone, {name}. Take this composer",
      "All your base are belong to {name}",
    ],
  },
  {
    tier: "uncommon",
    odds: 100,
    lines: [
      "A wild {name} appeared!",
      "Achievement unlocked, {name}: a new chat",
      "You found a four-leaf greeting, {name}",
    ],
  },
];

/** Questions under the greeting, by slot. */
const QUESTIONS = {
  night: ["What's on your mind tonight?", "What shall we think through?"],
  early: ["Where should we start?", "What's first?"],
  morning: ["What are we working on?", "Where should we start?"],
  afternoon: ["What needs fixing?", "What are we building?"],
  evening: ["What shall we think through?", "What are we building tonight?"],
  late: ["What's on your mind tonight?", "What shall we think through?"],
} satisfies Record<Slot, ReadonlyArray<string>>;

/** The random draws behind one greeting, each in [0, 1). */
export type GreetingRolls = { line: number; rarity: number; question: number };

export type Greeting = {
  text: string;
  /** Set when a rare line was drawn. */
  rarity: Rarity | null;
  /** A question for under the greeting, unless the greeting asks one. */
  question: string | null;
};

function pick<T>(items: ReadonlyArray<T>, roll: number): T {
  return items[Math.floor(roll * items.length) % items.length];
}

/** Lines whose name cannot drop as ", {name}", with their nameless text. */
const NAMELESS = new Map([
  ["Hello, world. Hello, {name}.", "Hello, world."],
  ["All your base are belong to {name}", "All your base are belong to us"],
  ["A wild {name} appeared!", "A wild owner appeared!"],
]);

function fill(line: string, name: string | null): string {
  if (name !== null) return line.replace("{name}", name);

  return NAMELESS.get(line) ?? line.replace(", {name}", "");
}

/** The new-chat page's greeting at a local date and time, for the name the
 *  owner asked to be called, if any. A caller rolls once per visit, so the
 *  greeting holds while the page is open, and rolls again to redraw it. */
export function drawGreeting(
  date: Date,
  name: string | null,
  rolls: GreetingRolls,
): Greeting {
  const rare = RARE.find((tier) => rolls.rarity < 1 / tier.odds);

  const line = rare
    ? pick(rare.lines, rolls.line)
    : pick(greetingLines(date), rolls.line);

  const filled = fill(line, name);

  const text = monthDay(date) === "10-22" ? filled.toUpperCase() : filled;

  return {
    text,
    rarity: rare ? { tier: rare.tier, odds: rare.odds } : null,
    question: text.endsWith("?")
      ? null
      : pick(QUESTIONS[slotOf(date.getHours())], rolls.question),
  };
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
