import { describe, expect, it } from "vitest";
import { GIT_METHODS, isGitMethod } from "./git";

describe("the git method vocabulary", () => {
  // The literal anchor: the wire names are a contract with every daemon.
  it("names the five methods the spec requires", () => {
    expect(GIT_METHODS).toEqual([
      "git.inspect",
      "git.worktreeAdd",
      "git.worktreeList",
      "git.worktreeRemove",
      "git.status",
    ]);
  });

  it("recognises a git method and nothing else", () => {
    expect(isGitMethod("git.inspect")).toBe(true);
    expect(isGitMethod("fs.read")).toBe(false);
    expect(isGitMethod("git")).toBe(false);
  });
});
