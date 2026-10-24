import { STDERR_BOUND, boundedText, redactCredentials } from "./output";

describe("redactCredentials", () => {
  it("removes a token carried in a clone URL userinfo part", () => {
    expect(
      redactCredentials(
        "fatal: unable to access 'https://ghp_secret@github.com/leon0399/llame/'",
      ),
    ).toBe("fatal: unable to access 'https://github.com/leon0399/llame/'");
    expect(redactCredentials("https://user:password@host/owner/repo")).toBe(
      "https://host/owner/repo",
    );
  });

  it("keeps the scp-style git user, which carries no password", () => {
    expect(redactCredentials("git@github.com:leon0399/llame.git")).toBe(
      "git@github.com:leon0399/llame.git",
    );
  });
});

describe("boundedText", () => {
  it("leaves text at or under the bound untouched", () => {
    expect(boundedText("x".repeat(STDERR_BOUND), STDERR_BOUND)).toHaveLength(
      STDERR_BOUND,
    );
  });

  it("truncates past the bound and says so", () => {
    const bounded = boundedText("y".repeat(STDERR_BOUND + 10), STDERR_BOUND);

    expect(bounded).toBe(`${"y".repeat(STDERR_BOUND)}\n[truncated]`);
  });
});
