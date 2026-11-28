import { describe, expect, it } from "vitest";

import { drawThinkingVerb, everydayVerbs } from "./thinking-verbs";

/** A local date; month is 1-based here. 2026-11-24 is a Tuesday. */
const at = (month: number, day: number, hour: number) =>
  new Date(2026, month - 1, day, hour);

const ordinary = { rarity: 0.5, special: 0.99 };

describe("drawThinkingVerb", () => {
  it("draws an everyday verb on an ordinary wait", () => {
    const date = at(11, 24, 10);

    expect(everydayVerbs(date)).toContain(
      drawThinkingVerb(date, { verb: 0.3, ...ordinary }),
    );
  });

  it("adds the hour's and the weekday's verbs", () => {
    expect(everydayVerbs(at(11, 24, 2))).toContain("Burning the midnight oil");
    expect(everydayVerbs(at(11, 24, 10))).not.toContain(
      "Burning the midnight oil",
    );
    expect(everydayVerbs(at(11, 27, 10))).toContain("Fridaying");
    expect(everydayVerbs(at(11, 24, 10))).not.toContain("Fridaying");
  });

  it("draws a special day's verbs on most waits that day", () => {
    const towelDay = at(5, 25, 10);

    expect(
      drawThinkingVerb(towelDay, { verb: 0, rarity: 0.5, special: 0.1 }),
    ).toBe("Not panicking");
    expect(everydayVerbs(towelDay)).toContain(
      drawThinkingVerb(towelDay, { verb: 0, rarity: 0.5, special: 0.9 }),
    );
  });

  it("shouts on Caps Lock Day", () => {
    expect(
      drawThinkingVerb(at(10, 22, 10), { verb: 0, rarity: 0.5, special: 0.1 }),
    ).toBe("THINKING");
  });

  it("draws a rare verb by its odds, rarest first", () => {
    const date = at(11, 24, 10);

    const draw = (rarity: number) =>
      drawThinkingVerb(date, { verb: 0, rarity, special: 0.99 });

    expect(draw(9e-6)).toBe("Finding the question to 42");
    expect(draw(9e-5)).toBe("Consulting the ancient scrolls");
    expect(draw(9e-4)).toBe("Reversing the polarity");
    expect(draw(0.009)).toBe("Summoning the llama council");
    expect(everydayVerbs(date)).toContain(draw(0.01));
  });
});
