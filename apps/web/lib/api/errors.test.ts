import { describe, expect, it } from "vitest";
import { getApiErrorInfo, getApiErrorStatus, isApiError } from "./errors";

describe("API error helpers", () => {
  it("recognizes status-bearing errors with unknown info", () => {
    const error = {
      status: 409,
      info: { code: "name_taken", detail: "Already used" },
    };

    expect(isApiError(error)).toBe(true);
    expect(getApiErrorStatus(error)).toBe(409);
    expect(getApiErrorInfo(error)).toEqual({
      code: "name_taken",
      detail: "Already used",
    });
  });

  it("rejects arbitrary errors and safely returns undefined accessors", () => {
    const error = new Error("network failed");

    expect(isApiError(error)).toBe(false);
    expect(getApiErrorStatus(error)).toBeUndefined();
    expect(getApiErrorInfo(error)).toBeUndefined();
    expect(isApiError({ status: "409", info: {} })).toBe(false);
    expect(isApiError({ status: 409 })).toBe(false);
  });
});
