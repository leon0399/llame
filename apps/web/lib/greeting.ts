import {
  slotOf,
  specialDayOf,
  type Slot,
  type SpecialDayId,
} from "./calendar-day";

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

/** A special day's own greetings and questions, which replace the usual. */
type Special = {
  lines: ReadonlyArray<string>;
  questions: ReadonlyArray<string>;
};

const special = (
  lines: ReadonlyArray<string>,
  questions: ReadonlyArray<string>,
): Special => ({ lines, questions });

/** Each special day's own greetings and questions. */
const SPECIALS = new Map<SpecialDayId, Special>([
  [
    "new-year",
    special(
      ["Happy New Year, {name}", "Fresh year, {name}. Where to?"],
      ["What's first this year, {name}?"],
    ),
  ],
  [
    "groundhog",
    special(
      ["Again, {name}? Happy Groundhog Day"],
      ["Same as yesterday, or something new?"],
    ),
  ],
  [
    "valentine",
    special(["Happy Valentine's Day, {name}"], ["Love letter, or code?"]),
  ],
  [
    "leap-day",
    special(
      ["A leap day, {name}. Make it count"],
      ["What will you do with the extra day, {name}?"],
    ),
  ],
  [
    "womens-day",
    special(["Happy Women's Day, {name}"], ["What are we working on today?"]),
  ],
  [
    "pi-day",
    special(["Happy Pi Day, {name}"], ["What are we computing today, {name}?"]),
  ],
  [
    "april-fools",
    special(
      ["No pranks today, {name}. Mostly"],
      ["Honest question: what are we doing today?"],
    ),
  ],
  [
    "earth-day",
    special(["Happy Earth Day, {name}"], ["What are we growing today?"]),
  ],
  [
    "star-wars",
    special(
      ["May the Fourth be with you, {name}"],
      ["What shall we build, young Padawan?"],
    ),
  ],
  [
    "towel-day",
    special(
      ["Happy Towel Day, {name}. Don't panic"],
      ["Got your towel, {name}?"],
    ),
  ],
  [
    "pirate",
    special(
      ["Ahoy, {name}! Talk Like a Pirate Day"],
      ["What be we plunderin' today?"],
    ),
  ],
  [
    "hobbit",
    special(
      ["Second breakfast, {name}? Happy Hobbit Day"],
      ["What's on the menu for elevenses?"],
    ),
  ],
  [
    "back-to-the-future",
    special(
      ["Great Scott, {name}! Back to the Future Day"],
      ["Where are we going today, {name}?"],
    ),
  ],
  [
    "caps-lock",
    special(["Happy Caps Lock Day, {name}"], ["What are we building, {name}?"]),
  ],
  [
    "mole-day",
    special(["Happy Mole Day, {name}"], ["What are we measuring today?"]),
  ],
  [
    "halloween",
    special(
      ["Happy Halloween, {name}", "Spooky season, {name}?"],
      ["Trick or treat: what's the task?", "Any bugs hiding in the dark?"],
    ),
  ],
  [
    "christmas-eve",
    special(
      ["Merry Christmas Eve, {name}"],
      ["What's on your wish list, {name}?"],
    ),
  ],
  [
    "christmas",
    special(
      ["Merry Christmas, {name}", "Happy holidays, {name}"],
      ["What's on your wish list, {name}?", "Anything to unwrap today?"],
    ),
  ],
  [
    "new-years-eve",
    special(
      ["Last one of the year, {name}?", "Wrapping up the year, {name}?"],
      ["What's left to wrap up this year?"],
    ),
  ],
  [
    "equinox",
    special(
      ["Equinox today, {name}. Day and night even"],
      ["A balanced day: what's the plan?"],
    ),
  ],
  [
    "solstice",
    special(
      ["Solstice today, {name}"],
      ["A turning point of the year: what's next?"],
    ),
  ],
  [
    "clocks-forward",
    special(
      ["Lost an hour of sleep, {name}?"],
      ["What can we get done in fewer hours?"],
    ),
  ],
  [
    "clocks-back",
    special(
      ["Enjoy the extra hour, {name}"],
      ["What will you do with the extra hour?"],
    ),
  ],
  [
    "unix-milestone",
    special(
      ["Unix time hits {milestone} today, {name}"],
      ["Shall we count the seconds?"],
    ),
  ],
  [
    "programmers-day",
    special(
      ["Happy Programmers' Day, {name}"],
      ["What are we shipping today, {name}?"],
    ),
  ],
  [
    "friday-13",
    special(
      ["Friday the 13th, {name}. Nothing to fear"],
      ["Feeling lucky, {name}?"],
    ),
  ],
]);

/** The special day a date is, with its lines, if any. */
function specialDay(date: Date): Special | undefined {
  const day = specialDayOf(date);
  const found = day === null ? undefined : SPECIALS.get(day.id);

  if (day?.milestone === undefined || found === undefined) return found;

  const milestone = day.milestone.toLocaleString("en-US");

  return special(
    found.lines.map((line) => line.replace("{milestone}", milestone)),
    found.questions,
  );
}

/** Questions for any day, by slot. */
const QUESTIONS = {
  night: [
    "What's on your mind tonight, {name}?",
    "What shall we think through?",
    "What's keeping you up?",
  ],
  early: [
    "Where should we start, {name}?",
    "What's first?",
    "What's the plan for today?",
  ],
  morning: [
    "What are we working on, {name}?",
    "Where should we start?",
    "What's on today's list?",
  ],
  afternoon: [
    "What needs fixing, {name}?",
    "What are we building?",
    "What's next on the list?",
  ],
  evening: [
    "What shall we think through, {name}?",
    "What are we building tonight?",
    "Anything left over from today?",
  ],
  late: [
    "What's on your mind tonight, {name}?",
    "One more thing before bed?",
    "What's keeping you up?",
  ],
} satisfies Record<Slot, ReadonlyArray<string>>;

const WEEKEND_QUESTIONS = [
  "Working on something fun, {name}?",
  "What are we tinkering with?",
];

/** Questions a weekday adds, 0 being Sunday. */
const WEEKDAY_QUESTIONS: ReadonlyArray<ReadonlyArray<string>> = [
  WEEKEND_QUESTIONS,
  ["What's the plan for the week, {name}?"],
  [],
  ["What's left for this week?"],
  [],
  ["What should ship before the weekend?"],
  WEEKEND_QUESTIONS,
];

/** The lines a greeting is drawn from at a local date and time. */
export function greetingLines(date: Date): ReadonlyArray<string> {
  const day = specialDay(date);

  if (day) return day.lines;

  const slot = slotOf(date.getHours());

  return [...ANY_DAY[slot], ...(BY_WEEKDAY[date.getDay()][slot] ?? [])];
}

/** The questions under a greeting at a local date and time. */
export function greetingQuestions(date: Date): ReadonlyArray<string> {
  return (
    specialDay(date)?.questions ?? [
      ...QUESTIONS[slotOf(date.getHours())],
      ...WEEKDAY_QUESTIONS[date.getDay()],
    ]
  );
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

/** The random draws behind one greeting, each in [0, 1). */
export type GreetingRolls = { line: number; rarity: number; question: number };

export type Greeting = {
  text: string;
  /** Set when a rare line was drawn. */
  rarity: Rarity | null;
  /** A question for under the greeting, unless the greeting asks one. It
   *  names the owner only when the greeting did not. */
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

  const named = name !== null && line.includes("{name}");
  const shout = specialDayOf(date)?.id === "caps-lock";
  const cased = (value: string) => (shout ? value.toUpperCase() : value);
  const text = cased(fill(line, name));

  return {
    text,
    rarity: rare ? { tier: rare.tier, odds: rare.odds } : null,
    question: text.endsWith("?")
      ? null
      : cased(
          fill(
            pick(greetingQuestions(date), rolls.question),
            named ? null : name,
          ),
        ),
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
