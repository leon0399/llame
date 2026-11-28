import { describe, expect, it } from "vitest";

import { greeting, greetingName } from "./greeting";

describe("greeting", () => {
  it.each([
    [4, "Good evening"],
    [5, "Good morning"],
    [11, "Good morning"],
    [12, "Good afternoon"],
    [16, "Good afternoon"],
    [17, "Good evening"],
    [23, "Good evening"],
  ])("hour %i says %s", (hour, expected) => {
    expect(greeting(hour, null)).toBe(expected);
  });

  it("appends the name", () => {
    expect(greeting(9, "Leo")).toBe("Good morning, Leo");
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
