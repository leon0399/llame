import {
  slotOf,
  specialDayOf,
  type Slot,
  type SpecialDayId,
} from "./calendar-day";

/*
 * The verb on the line that shows the model at work ("Pondering…"). Drawn
 * like the new-chat greeting: an everyday pool that the hour and weekday
 * add to, special days with verbs of their own, and now and then a rare
 * one, 1 in 100 up to 1 in 100,000.
 */

const EVERYDAY = [
  "Thinking",
  "Pondering",
  "Mulling",
  "Musing",
  "Ruminating",
  "Cogitating",
  "Contemplating",
  "Deliberating",
  "Considering",
  "Puzzling",
  "Noodling",
  "Percolating",
  "Brewing",
  "Simmering",
  "Marinating",
  "Stewing",
  "Fermenting",
  "Kneading",
  "Proofing",
  "Whisking",
  "Seasoning",
  "Concocting",
  "Cooking",
  "Baking",
  "Crunching",
  "Computing",
  "Calculating",
  "Deciphering",
  "Untangling",
  "Synthesizing",
  "Crystallizing",
  "Coalescing",
  "Orchestrating",
  "Choreographing",
  "Composing",
  "Sketching",
  "Doodling",
  "Tinkering",
  "Puttering",
  "Wrangling",
  "Herding",
  "Forging",
  "Crafting",
  "Hatching",
  "Incubating",
  "Germinating",
  "Sprouting",
  "Unfurling",
  "Spelunking",
  "Meandering",
  "Moseying",
  "Wandering",
  "Orbiting",
  "Levitating",
  "Reticulating",
  "Combobulating",
  "Recombobulating",
  "Finagling",
  "Shimmying",
  "Moonwalking",
  "Vibing",
  "Whirring",
  "Grazing",
  "Herding llamas",
  "Chewing the cud",
  "Connecting the dots",
  "Reading between the lines",
  "Turning it over",
  "Following the thread",
  "Consulting the rubber duck",
];

/** Verbs an hour of the day adds. */
const BY_SLOT = {
  night: ["Burning the midnight oil", "Thinking by moonlight", "Stargazing"],
  early: ["Brewing coffee", "Stretching", "Waking the neurons"],
  morning: ["Rolling up sleeves", "Sharpening pencils"],
  afternoon: ["Refilling the tea", "Beating the slump"],
  evening: ["Winding down", "Lighting the lamps"],
  late: ["Pulling an all-nighter", "Burning the midnight oil", "Owling"],
} satisfies Record<Slot, ReadonlyArray<string>>;

const WEEKEND = ["Weekending", "Lounging thoughtfully", "Pottering about"];

/** Verbs a weekday adds, 0 being Sunday. */
const BY_WEEKDAY: ReadonlyArray<ReadonlyArray<string>> = [
  [...WEEKEND, "Sundaying"],
  ["Mondaying", "Easing into the week"],
  ["Tuesdaying"],
  ["Getting over the hump"],
  ["Almost-Fridaying"],
  ["Fridaying", "Daydreaming about the weekend"],
  [...WEEKEND, "Saturdaying"],
];

/** Verbs of a special day, drawn on most waits that day. */
const BY_SPECIAL: Record<SpecialDayId, ReadonlyArray<string>> = {
  "new-year": ["Making resolutions", "Toasting", "Starting fresh"],
  groundhog: ["Thinking. Again", "Repeating", "Checking for shadows"],
  valentine: ["Writing love letters", "Swooning", "Picking roses"],
  "leap-day": ["Leaping", "Using the bonus day"],
  "womens-day": ["Picking flowers", "Celebrating"],
  "pi-day": ["Baking a pie", "Computing more digits of pi", "Going in circles"],
  "april-fools": ["Definitely not pranking", "Keeping a straight face"],
  "earth-day": ["Composting thoughts", "Planting ideas", "Photosynthesizing"],
  "star-wars": [
    "Using the Force",
    "Jumping to hyperspace",
    "Bargaining with Jawas",
  ],
  "towel-day": ["Not panicking", "Finding a towel", "Hitchhiking"],
  pirate: ["Plunderin'", "Swabbin' the deck", "Hoistin' the sails"],
  hobbit: ["Having second breakfast", "Going there and back again"],
  "back-to-the-future": ["Charging the flux capacitor", "Hitting 88 mph"],
  "caps-lock": ["Thinking", "Pondering", "Shouting thoughtfully"],
  "mole-day": ["Counting molecules", "Balancing equations"],
  halloween: ["Conjuring", "Carving pumpkins", "Brewing potions", "Haunting"],
  "christmas-eve": ["Wrapping presents", "Checking the list twice"],
  christmas: ["Unwrapping", "Checking the list twice", "Sipping cocoa"],
  "new-years-eve": ["Counting down", "Chilling the bubbly"],
  equinox: ["Balancing", "Splitting the day evenly"],
  solstice: ["Chasing the sun", "Turning the year"],
  "clocks-forward": ["Springing forward", "Finding the lost hour"],
  "clocks-back": ["Falling back", "Enjoying the extra hour"],
  "unix-milestone": ["Counting seconds", "Watching the odometer"],
  "programmers-day": ["Compiling", "Shipping", "Refactoring"],
  "friday-13": ["Knocking on wood", "Avoiding ladders"],
};

/** Rare verbs, rarest first, with the odds of one per wait. */
const RARE: ReadonlyArray<{ odds: number; verbs: ReadonlyArray<string> }> = [
  {
    odds: 100_000,
    verbs: [
      "Finding the question to 42",
      "Achieving enlightenment, one token at a time",
    ],
  },
  {
    odds: 10_000,
    verbs: ["Consulting the ancient scrolls", "Asking the llama elders"],
  },
  {
    odds: 1000,
    verbs: ["Reversing the polarity", "Dividing by zero, carefully"],
  },
  {
    odds: 100,
    verbs: [
      "Summoning the llama council",
      "Asking the rubber duck's manager",
      "Flibbertigibbeting",
      "Discombobulating",
    ],
  },
];

/** The random draws behind one verb, each in [0, 1). */
export type VerbRolls = { verb: number; rarity: number; special: number };

/** Share of waits on a special day that draw its own verbs. */
const SPECIAL_SHARE = 0.6;

function pick(items: ReadonlyArray<string>, roll: number): string {
  return items[Math.floor(roll * items.length) % items.length];
}

/** The verbs drawn from at a local date and time on an ordinary wait. */
export function everydayVerbs(date: Date): ReadonlyArray<string> {
  return [
    ...EVERYDAY,
    ...BY_SLOT[slotOf(date.getHours())],
    ...BY_WEEKDAY[date.getDay()],
  ];
}

/** The verb for one wait at a local date and time, without its ellipsis. */
export function drawThinkingVerb(date: Date, rolls: VerbRolls): string {
  const day = specialDayOf(date);
  const rare = RARE.find((tier) => rolls.rarity < 1 / tier.odds);

  const verb = rare
    ? pick(rare.verbs, rolls.verb)
    : day !== null && rolls.special < SPECIAL_SHARE
      ? pick(BY_SPECIAL[day.id], rolls.verb)
      : pick(everydayVerbs(date), rolls.verb);

  return day?.id === "caps-lock" ? verb.toUpperCase() : verb;
}
