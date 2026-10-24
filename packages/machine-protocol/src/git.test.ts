import { describe, expect, it } from "vitest";
import {
  GIT_INSPECT_METHOD,
  GIT_METHODS,
  GIT_STATUS_METHOD,
  GIT_WORKTREE_ADD_METHOD,
  GIT_WORKTREE_LIST_METHOD,
  GIT_WORKTREE_REMOVE_METHOD,
  isGitMethod,
  supportsGitMethod,
} from "./git";
import type { HelloResult, MachineMethodParams } from "./types";

const HELLO: HelloResult = {
  protocolVersion: 1,
  daemonVersion: "0.0.1",
  roots: ["/srv"],
};

const PREFIX = "machine://devl";

describe("the git method vocabulary", () => {
  it("names the five methods the spec requires, once each", () => {
    expect(GIT_METHODS).toEqual([
      GIT_INSPECT_METHOD,
      GIT_WORKTREE_ADD_METHOD,
      GIT_WORKTREE_LIST_METHOD,
      GIT_WORKTREE_REMOVE_METHOD,
      GIT_STATUS_METHOD,
    ]);
    expect(GIT_METHODS).toHaveLength(5);
    expect(GIT_METHODS).toEqual([
      "git.inspect",
      "git.worktreeAdd",
      "git.worktreeList",
      "git.worktreeRemove",
      "git.status",
    ]);
  });

  it("recognises a git method and nothing else", () => {
    for (const method of GIT_METHODS) expect(isGitMethod(method)).toBe(true);
    expect(isGitMethod("fs.read")).toBe(false);
    expect(isGitMethod("git")).toBe(false);
  });
});

describe("the handshake's git method list", () => {
  it("answers false for a daemon that predates the list", () => {
    expect(supportsGitMethod(HELLO, GIT_INSPECT_METHOD)).toBe(false);
    expect(supportsGitMethod(undefined, GIT_STATUS_METHOD)).toBe(false);
  });

  it("answers for the methods a daemon lists", () => {
    const listed: HelloResult = {
      ...HELLO,
      methods: [GIT_INSPECT_METHOD, GIT_STATUS_METHOD],
    };
    expect(supportsGitMethod(listed, GIT_INSPECT_METHOD)).toBe(true);
    expect(supportsGitMethod(listed, GIT_STATUS_METHOD)).toBe(true);
    expect(supportsGitMethod(listed, GIT_WORKTREE_ADD_METHOD)).toBe(false);
  });

  it("carries every method a daemon answers", () => {
    const listed: HelloResult = { ...HELLO, methods: [...GIT_METHODS] };
    for (const method of GIT_METHODS)
      expect(supportsGitMethod(listed, method)).toBe(true);
  });
});

describe("the git parameter shape", () => {
  /** The compile-time half: every method takes its typed input with the
   *  display options that make its result paths locators. */
  const params = {
    "git.inspect": {
      envelope: { budgetMs: 1000 },
      path: "/srv/app",
      options: { displayPrefix: PREFIX },
    },
    "git.worktreeAdd": {
      envelope: { budgetMs: 1000 },
      source: "/srv/app",
      branch: "llame/shop",
      baseRef: "HEAD",
      directory: "/srv/trees/shop",
      options: { displayPrefix: PREFIX },
    },
    "git.worktreeList": {
      envelope: { budgetMs: 1000 },
      source: "/srv/app",
      options: { displayPrefix: PREFIX },
    },
    "git.worktreeRemove": {
      envelope: { budgetMs: 1000 },
      path: "/srv/trees/shop",
      options: { displayPrefix: PREFIX },
    },
    "git.status": {
      envelope: { budgetMs: 1000 },
      path: "/srv/app",
      options: { displayPrefix: PREFIX },
    },
  } satisfies {
    readonly [M in keyof MachineMethodParams &
      `git.${string}`]: MachineMethodParams[M];
  };

  it("takes the display prefix on every method", () => {
    for (const value of Object.values(params))
      expect(value.options.displayPrefix).toBe(PREFIX);
    expect(Object.keys(params).sort()).toEqual([...GIT_METHODS].sort());
  });
});
