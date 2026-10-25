import { describe, expect, it } from "vitest";

import { repositoryFailureMessage } from "./failure";

describe("repositoryFailureMessage", () => {
  it("keeps the server's own refusal sentence", () => {
    const error = Object.assign(new Error("DELETE failed (409)"), {
      status: 409,
      info: {
        statusCode: 409,
        error: "Conflict",
        code: "worktree_not_clean",
        message: "The worktree holds uncommitted changes.",
      },
    });

    expect(repositoryFailureMessage(error, "Couldn't remove it.")).toBe(
      "The worktree holds uncommitted changes.",
    );
  });

  it("falls back when the failure carries no typed envelope", () => {
    expect(
      repositoryFailureMessage(new TypeError("fetch failed"), "Try again."),
    ).toBe("Try again.");
  });

  it("falls back on a blank message", () => {
    const error = Object.assign(new Error("failed"), {
      status: 409,
      info: { message: "   " },
    });

    expect(repositoryFailureMessage(error, "Try again.")).toBe("Try again.");
  });
});
