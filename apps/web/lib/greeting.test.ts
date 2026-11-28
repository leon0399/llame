import { describe, expect, it } from "vitest";

import { greeting, greetingLines, greetingName } from "./greeting";

/** A local date; month is 1-based here. 2026-11-24 is a Tuesday. */
const at = (month: number, day: number, hour: number, year = 2026) =>
  new Date(year, month - 1, day, hour);

const plainLines = (date: Date) => {
  const count = greetingLines(date).length;

  return Array.from({ length: count }, (_, i) =>
    greeting(date, null, (i + 0.5) / count),
  );
};

describe("greeting", () => {
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
    expect(greeting(at(12, 25, 20), "Leo", 0)).toBe("Merry Christmas, Leo");
  });

  it("finds Friday the 13th", () => {
    expect(plainLines(at(11, 13, 10))).toEqual([
      "Friday the 13th. Nothing to fear",
    ]);
    expect(plainLines(at(10, 13, 10))).not.toContain(
      "Friday the 13th. Nothing to fear",
    );
  });

  it("finds Programmers' Day on the 256th day, leap years included", () => {
    expect(plainLines(at(9, 13, 10, 2026))).toEqual(["Happy Programmers' Day"]);
    expect(plainLines(at(9, 12, 10, 2028))).toEqual(["Happy Programmers' Day"]);
    expect(plainLines(at(9, 13, 10, 2028))).not.toContain(
      "Happy Programmers' Day",
    );
  });

  it("names the owner where a line does, and reads cleanly without a name", () => {
    for (let day = 22; day <= 28; day += 1) {
      for (const hour of [3, 6, 10, 14, 19, 23]) {
        const date = at(11, day, hour);

        for (const [index, line] of greetingLines(date).entries()) {
          const roll = (index + 0.5) / greetingLines(date).length;
          const named = greeting(date, "Leo", roll);

          expect(named).not.toContain("{name}");
          expect(named.includes("Leo")).toBe(line.includes("{name}"));
          expect(greeting(date, null, roll)).not.toMatch(/\{name\}|,\s*[.?]?$/);
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
