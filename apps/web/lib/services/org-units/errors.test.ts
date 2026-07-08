import { describe, expect, it, vi } from "vitest";

const { FakeHTTPError } = vi.hoisted(() => {
  class FakeHTTPError extends Error {
    response: { status: number; json: () => Promise<unknown> };
    constructor(status: number, body?: unknown) {
      super(`HTTP ${status}`);
      this.response = {
        status,
        json: () =>
          body === undefined
            ? Promise.reject(new Error("no body"))
            : Promise.resolve(body),
      };
    }
  }
  return { FakeHTTPError };
});

vi.mock("ky", () => ({ HTTPError: FakeHTTPError }));

import { classifyOrgUnitsError, OrgUnitsApiError } from "./errors";

describe("classifyOrgUnitsError", () => {
  it("maps a non-HTTPError to unknown", async () => {
    const result = await classifyOrgUnitsError(new Error("network down"));
    expect(result).toBeInstanceOf(OrgUnitsApiError);
    expect(result.kind).toBe("unknown");
  });

  it("maps 403 to forbidden with a role-explaining message", async () => {
    const result = await classifyOrgUnitsError(new FakeHTTPError(403));
    expect(result.kind).toBe("forbidden");
    expect(result.message).toMatch(/admin or owner/i);
  });

  it("maps 404 to not-found without leaking existence details", async () => {
    const result = await classifyOrgUnitsError(
      new FakeHTTPError(404, { message: "Org unit abc-123 not found" }),
    );
    expect(result.kind).toBe("not-found");
    expect(result.message).not.toMatch(/abc-123/);
  });

  it("maps a last-owner 409 by message content", async () => {
    const result = await classifyOrgUnitsError(
      new FakeHTTPError(409, {
        message:
          "Cannot remove the last owner of this org — transfer ownership first",
      }),
    );
    expect(result.kind).toBe("last-owner");
    expect(result.message).toMatch(/transfer ownership/i);
  });

  it("maps a duplicate-membership 409 by message content", async () => {
    const result = await classifyOrgUnitsError(
      new FakeHTTPError(409, {
        message: "User is already a member of this org unit",
      }),
    );
    expect(result.kind).toBe("duplicate-membership");
    expect(result.message).toMatch(/already a member/i);
  });

  it("classifies by the machine-readable code, even when the copy changes", async () => {
    const result = await classifyOrgUnitsError(
      new FakeHTTPError(409, {
        message: "Reworded copy that mentions neither phrase",
        code: "LAST_OWNER",
      }),
    );
    expect(result.kind).toBe("last-owner");
  });

  it("maps a DUPLICATE_MEMBERSHIP code to duplicate-membership", async () => {
    const result = await classifyOrgUnitsError(
      new FakeHTTPError(409, {
        message: "anything",
        code: "DUPLICATE_MEMBERSHIP",
      }),
    );
    expect(result.kind).toBe("duplicate-membership");
  });

  it("maps a HAS_CHILDREN 409 to validation, not a retryable concurrent-change", async () => {
    const result = await classifyOrgUnitsError(
      new FakeHTTPError(409, {
        message: "Org unit has child units — delete them first",
        code: "HAS_CHILDREN",
      }),
    );
    expect(result.kind).toBe("validation");
    expect(result.message).toMatch(/child units/i);
  });

  it("falls back to concurrent-change for an unrecognized 409", async () => {
    const result = await classifyOrgUnitsError(
      new FakeHTTPError(409, { message: "Org tree changed concurrently" }),
    );
    expect(result.kind).toBe("concurrent-change");
    expect(result.message).toMatch(/tree changed/i);
  });

  it("treats a bodyless 409 as concurrent-change too", async () => {
    const result = await classifyOrgUnitsError(new FakeHTTPError(409));
    expect(result.kind).toBe("concurrent-change");
  });

  it("maps 422 to validation, surfacing the API's message", async () => {
    const result = await classifyOrgUnitsError(
      new FakeHTTPError(422, { message: "Cannot move into own subtree" }),
    );
    expect(result.kind).toBe("validation");
    expect(result.message).toBe("Cannot move into own subtree");
  });

  it("maps any other status to unknown", async () => {
    const result = await classifyOrgUnitsError(new FakeHTTPError(500));
    expect(result.kind).toBe("unknown");
  });
});
