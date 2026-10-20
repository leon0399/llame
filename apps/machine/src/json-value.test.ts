import { describe, expect, it } from "vitest";
import { UnserializableJsonError, toJsonValue } from "./json-value";

describe("toJsonValue", () => {
  it("keeps every JSON scalar", () => {
    expect(toJsonValue("text")).toBe("text");
    expect(toJsonValue(true)).toBe(true);
    expect(toJsonValue(0)).toBe(0);
    expect(toJsonValue(null)).toBeNull();
  });

  it("walks containers and drops absent members", () => {
    expect(
      toJsonValue({
        list: [1, "two", null, { nested: true }],
        absent: undefined,
      }),
    ).toEqual({ list: [1, "two", null, { nested: true }] });
    expect(toJsonValue([])).toEqual([]);
  });

  it("refuses a value JSON cannot spell", () => {
    expect(() => toJsonValue(Number.NaN)).toThrow(UnserializableJsonError);
    expect(() => toJsonValue(Number.POSITIVE_INFINITY)).toThrow(
      UnserializableJsonError,
    );
    expect(() => toJsonValue(undefined)).toThrow(UnserializableJsonError);
    expect(() => toJsonValue(() => 1)).toThrow(UnserializableJsonError);
    expect(() => toJsonValue(Symbol("value"))).toThrow(UnserializableJsonError);
    expect(() => toJsonValue(10n)).toThrow(UnserializableJsonError);
    expect(() => toJsonValue([1, undefined])).toThrow(UnserializableJsonError);
    expect(() => toJsonValue({ nested: { absent: undefined } })).not.toThrow();
  });

  it("names the refusal", () => {
    expect(new UnserializableJsonError().message).toBe(
      "The value is not a JSON value.",
    );
    expect(new UnserializableJsonError().name).toBe("UnserializableJsonError");
  });
});
