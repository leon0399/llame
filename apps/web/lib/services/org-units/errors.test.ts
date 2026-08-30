import { describe, expect, it } from "vitest";

import { classifyOrgUnitsError, OrgUnitsApiError } from "./errors";

function protocolError<T>(status: number, info?: T) {
  return { status, info };
}

describe("classifyOrgUnitsError", () => {
  it("maps a non-protocol error to unknown", async () => {
    const result = await classifyOrgUnitsError(new Error("network down"));
    expect(result).toBeInstanceOf(OrgUnitsApiError);
    expect(result.kind).toBe("unknown");
  });

  it("maps 403 to forbidden with a role-explaining message", async () => {
    const result = await classifyOrgUnitsError(protocolError(403, {}));
    expect(result.kind).toBe("forbidden");
    expect(result.message).toMatch(/admin or owner/i);
  });

  it("maps 404 to not-found without leaking existence details", async () => {
    const result = await classifyOrgUnitsError(
      protocolError(404, { message: "Org unit abc-123 not found" }),
    );
    expect(result.kind).toBe("not-found");
    expect(result.message).not.toMatch(/abc-123/);
  });

  it("maps the documented LAST_OWNER conflict code", async () => {
    const result = await classifyOrgUnitsError(
      protocolError(409, {
        statusCode: 409,
        error: "Conflict",
        message: "Server-owned detail",
        code: "LAST_OWNER",
      }),
    );
    expect(result.kind).toBe("last-owner");
    expect(result.message).toMatch(/transfer ownership/i);
  });

  it("maps the documented DUPLICATE_MEMBERSHIP conflict code", async () => {
    const result = await classifyOrgUnitsError(
      protocolError(409, {
        statusCode: 409,
        error: "Conflict",
        message: "Server-owned detail",
        code: "DUPLICATE_MEMBERSHIP",
      }),
    );
    expect(result.kind).toBe("duplicate-membership");
    expect(result.message).toMatch(/already a member/i);
  });

  it("maps the documented HAS_CHILDREN conflict code to validation", async () => {
    const result = await classifyOrgUnitsError(
      protocolError(409, {
        statusCode: 409,
        error: "Conflict",
        message: "Server-owned detail",
        code: "HAS_CHILDREN",
      }),
    );
    expect(result.kind).toBe("validation");
  });

  it("maps the documented CONCURRENT_TREE_CHANGE conflict code", async () => {
    const result = await classifyOrgUnitsError(
      protocolError(409, {
        statusCode: 409,
        error: "Conflict",
        message: "Server-owned detail",
        code: "CONCURRENT_TREE_CHANGE",
      }),
    );
    expect(result.kind).toBe("concurrent-change");
  });

  it("falls back to concurrent-change for an unrecognized 409", async () => {
    const result = await classifyOrgUnitsError(
      protocolError(409, { unexpected: "shape" }),
    );
    expect(result.kind).toBe("concurrent-change");
    expect(result.message).toMatch(/tree changed/i);
  });

  it("treats a bodyless 409 as concurrent-change too", async () => {
    const result = await classifyOrgUnitsError(protocolError(409));
    expect(result.kind).toBe("concurrent-change");
  });

  it("maps the documented MOVE_INTO_OWN_SUBTREE validation code", async () => {
    const result = await classifyOrgUnitsError(
      protocolError(422, {
        statusCode: 422,
        error: "Unprocessable Entity",
        message: "Cannot move into own subtree",
        code: "MOVE_INTO_OWN_SUBTREE",
      }),
    );
    expect(result.kind).toBe("validation");
    expect(result.message).toBe("Cannot move into own subtree");
  });

  it("maps an unknown body to unknown without exposing its contents", async () => {
    const result = await classifyOrgUnitsError(
      protocolError(500, { secret: "should not become UI copy" }),
    );
    expect(result.kind).toBe("unknown");
    expect(result.message).toBe("Something went wrong. Please try again.");
  });

  it("maps a malformed protocol body to unknown", async () => {
    const result = await classifyOrgUnitsError(protocolError(500, "not JSON"));
    expect(result.kind).toBe("unknown");
  });
});
