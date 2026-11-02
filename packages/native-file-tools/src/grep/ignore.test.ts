import { describe, expect, it } from "vitest";

import { compileIgnoreRules, decideIgnoreLayer } from "./ignore";

/** The verdict one ignore rule gives one path, as the walk asks it. */
function decides(rule: string, pathname: string): boolean | undefined {
  return decideIgnoreLayer(compileIgnoreRules(rule), pathname);
}

/**
 * The library behavior design D6 builds on. `ignore` 7.0.12 passes only the
 * `ignored` verdict down from an ancestor, never `unignored`, so a one-rule
 * negation instance reports a match on the tested path itself. An upgrade that
 * changes this must fail here before the walk silently over-excludes.
 */
describe("the ignore 7.0.12 negation probe", () => {
  it.each([
    ["node_modules/", "node_modules/react/", undefined],
    ["node_modules/", "node_modules/react/index.js", undefined],
    ["node_modules/", "a/node_modules/", true],
    ["docs/**", "docs/keep/a.md", true],
    ["build/", "src/build/a.js", undefined],
    ["*", "src/a.js", true],
    ["/build", "x/build", undefined],
    ["a/**", "a/b/c", true],
    ["logs/**", "logs/", undefined],
    ["docs/*.md", "docs/sub/b.md", undefined],
  ] as const)("rule %s against %s decides %s", (rule, pathname, decided) => {
    expect(decides(rule, pathname)).toBe(decided);
  });

  it("reports a negated rule's own match as a re-include", () => {
    expect(decides("!build-tools/", "build-tools/")).toBe(false);
    expect(decides("!build-tools/", "build-tools/build.sh")).toBeUndefined();
  });
});

describe("compileIgnoreRules", () => {
  it("keeps a comment line out of the rules", () => {
    // `ignore` reads `#` as a comment, but the negation instance would read
    // `!# …` as a rule for a file named `# …`; the compiler drops it first.
    expect(decides("# node_modules/\n", "# node_modules/")).toBeUndefined();
  });

  it("reads an escaped leading character as part of the pattern", () => {
    expect(decides("\\#keep\n", "#keep")).toBe(true);
    expect(decides("\\!keep\n", "!keep")).toBe(true);
  });

  it("lets the last matching rule of one file decide", () => {
    expect(decides("build*/\n!build-tools/\n", "build-tools/")).toBe(false);
    expect(decides("!build-tools/\nbuild*/\n", "build-tools/")).toBe(true);
  });

  it("ignores a blank line and a carriage return", () => {
    expect(decides("build/\r\n\r\n", "build/")).toBe(true);
  });
});
