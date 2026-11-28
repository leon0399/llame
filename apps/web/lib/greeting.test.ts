import { afterEach, describe, expect, it } from "vitest";

import {
  drawGreeting,
  greetingLines,
  greetingName,
  type GreetingRolls,
} from "./greeting";

/** A local date; month is 1-based here. 2026-11-24 is a Tuesday. */
const at = (month: number, day: number, hour: number, year = 2026) =>
  new Date(year, month - 1, day, hour);

/** Rolls that draw no rare line. */
const common = (line: number, question = 0): GreetingRolls => ({
  line,
  rarity: 0.5,
  question,
});

const text = (date: Date, name: string | null, rolls: GreetingRolls) =>
  drawGreeting(date, name, rolls).text;

/** Every line the date can draw, without a name. */
const plainLines = (date: Date) => {
  const count = greetingLines(date).length;

  return Array.from({ length: count }, (_, i) =>
    text(date, null, common((i + 0.5) / count)),
  );
};

describe("drawGreeting", () => {
  it.each([
    [3, "Hello, night owl"],
    [6, "Hey, early bird"],
    [10, "Good morning"],
    [14, "Good afternoon"],
    [19, "Good evening"],
    [23, "Hello, night owl"],
  ])("hour %i draws from its slot (%s)", (hour, expected) => {
    expect(plainLines(at(11, 24, hour))).toContain(expected);
  });

  it("never says good night", () => {
    for (const hour of [0, 3, 22, 23]) {
      expect(plainLines(at(11, 24, hour)).join(" ")).not.toMatch(/good night/i);
    }
  });

  it("adds the weekday's lines on that day only", () => {
    expect(plainLines(at(11, 27, 14))).toContain("Almost the weekend");
    expect(plainLines(at(11, 24, 14))).not.toContain("Almost the weekend");
    expect(plainLines(at(11, 28, 10))).toContain("Welcome to the weekend");
    expect(plainLines(at(11, 24, 10))).not.toContain("Welcome to the weekend");
  });

  it("replaces the slots on a holiday", () => {
    expect(plainLines(at(1, 1, 10))).toEqual([
      "Happy New Year",
      "Fresh year. Where to?",
    ]);
    expect(text(at(12, 25, 20), "Leo", common(0))).toBe("Merry Christmas, Leo");
  });

  it("shouts on Caps Lock Day", () => {
    expect(text(at(10, 22, 10), "Leo", common(0))).toBe(
      "HAPPY CAPS LOCK DAY, LEO",
    );
  });

  it("finds Friday the 13th and Programmers' Day", () => {
    expect(plainLines(at(11, 13, 10))).toEqual([
      "Friday the 13th. Nothing to fear",
    ]);
    expect(plainLines(at(9, 13, 10, 2026))).toEqual(["Happy Programmers' Day"]);
    expect(plainLines(at(9, 12, 10, 2028))).toEqual(["Happy Programmers' Day"]);
    expect(plainLines(at(9, 13, 10, 2028))).not.toContain(
      "Happy Programmers' Day",
    );
  });

  it("marks a solstice and a Unix-time milestone", () => {
    expect(plainLines(at(6, 21, 10))).toEqual(["Solstice today"]);
    // 1,800,000,000 s falls on 2027-01-15 in every zone's local day or the
    // neighbouring one; the day it falls in names it.
    const days = [14, 15, 16].map((day) => plainLines(at(1, day, 12, 2027)));

    expect(days.flat()).toContain("Unix time hits 1,800,000,000 today");
  });

  describe("on a clock change", () => {
    const zone = process.env.TZ;

    afterEach(() => {
      process.env.TZ = zone;
    });

    it("notices the lost and the extra hour", () => {
      process.env.TZ = "Europe/Madrid";

      expect(plainLines(at(3, 29, 10))).toEqual(["Lost an hour of sleep?"]);
      expect(plainLines(at(10, 25, 10))).toEqual(["Enjoy the extra hour"]);
    });
  });

  it("draws a rare line by its odds, rarest first", () => {
    const date = at(11, 24, 10);

    const tier = (rarity: number) =>
      drawGreeting(date, "Leo", { line: 0, rarity, question: 0 }).rarity;

    expect(tier(9e-6)).toEqual({ tier: "legendary", odds: 100_000 });
    expect(tier(9e-5)).toEqual({ tier: "epic", odds: 10_000 });
    expect(tier(9e-4)).toEqual({ tier: "rare", odds: 1000 });
    expect(tier(0.009)).toEqual({ tier: "uncommon", odds: 100 });
    expect(tier(0.01)).toBeNull();
    expect(
      drawGreeting(date, null, { line: 0, rarity: 0.009, question: 0 }).text,
    ).toBe("A wild owner appeared!");
  });

  it("asks a question only when the greeting does not", () => {
    const date = at(11, 24, 10);
    const lines = greetingLines(date);

    for (const [index, line] of lines.entries()) {
      const drawn = drawGreeting(
        date,
        "Leo",
        common((index + 0.5) / lines.length),
      );

      expect(drawn.question === null).toBe(line.endsWith("?"));
    }
  });

  it("names the owner where a line does, and reads cleanly without a name", () => {
    for (let day = 22; day <= 28; day += 1) {
      for (const hour of [3, 6, 10, 14, 19, 23]) {
        const date = at(11, day, hour);
        const lines = greetingLines(date);

        for (const [index, line] of lines.entries()) {
          const rolls = common((index + 0.5) / lines.length);
          const named = text(date, "Leo", rolls);

          expect(named).not.toContain("{name}");
          expect(named.includes("Leo")).toBe(line.includes("{name}"));
          expect(text(date, null, rolls)).not.toMatch(/\{name\}|,\s*[.?]?$/);
        }
      }
    }
  });
});

describe("greetingName", () => {
  it("prefers the personalization name", () => {
    expect(greetingName("  Leo ", "Leonid Meleshin")).toBe("Leo");
  });

  it("falls back to the account name's first word", () => {
    expect(greetingName("   ", "Leonid Meleshin")).toBe("Leonid");
  });

  it("is null when neither is set", () => {
    expect(greetingName(null, "  ")).toBeNull();
    expect(greetingName(undefined, null)).toBeNull();
  });
});
