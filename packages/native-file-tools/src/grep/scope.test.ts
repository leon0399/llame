import { compileGlob, normalizeHostScope, splitGrepScope } from "./scope";

describe("grep scope splitting", () => {
  it("splits at the first glob segment", () => {
    expect(splitGrepScope("/home/u/repo/**")).toEqual({
      prefix: "/home/u/repo/",
      globSuffix: "**",
      endsWithSeparator: false,
    });
    expect(splitGrepScope("/notes/**/*.md")).toEqual({
      prefix: "/notes/",
      globSuffix: "**/*.md",
      endsWithSeparator: false,
    });
  });

  it("keeps a directory prefix whole without a glob", () => {
    expect(splitGrepScope("/home/u/repo/src/")).toEqual({
      prefix: "/home/u/repo/src/",
      globSuffix: undefined,
      endsWithSeparator: true,
    });
    expect(splitGrepScope("/home/u/repo/src")).toEqual({
      prefix: "/home/u/repo/src",
      globSuffix: undefined,
      endsWithSeparator: false,
    });
  });

  it("treats a percent-encoded operator as literal text", () => {
    expect(splitGrepScope("/a%2Ab/")).toEqual({
      prefix: "/a%2Ab/",
      globSuffix: undefined,
      endsWithSeparator: true,
    });
    expect(splitGrepScope("/a%3Fb")).toEqual({
      prefix: "/a%3Fb",
      globSuffix: undefined,
      endsWithSeparator: false,
    });
    expect(splitGrepScope("/a%2Ab/*.md")).toMatchObject({
      prefix: "/a%2Ab/",
      globSuffix: "*.md",
    });
  });

  it("keeps a colon in the path part", () => {
    expect(splitGrepScope("/home/u/repo/v:1/**")).toMatchObject({
      prefix: "/home/u/repo/v:1/",
      globSuffix: "**",
    });
  });

  it("refuses the operators it does not support and names them", () => {
    expect(splitGrepScope("/repo/{a,b}")).toEqual({
      error: "unsupported_glob",
      operator: "{",
    });
    expect(splitGrepScope("/repo/[ab]/*.md")).toEqual({
      error: "unsupported_glob",
      operator: "[",
    });
  });

  it("splits a glob that starts at the first segment", () => {
    expect(splitGrepScope("/**")).toMatchObject({
      prefix: "/",
      globSuffix: "**",
    });
    expect(splitGrepScope("**")).toMatchObject({
      prefix: "",
      globSuffix: "**",
    });
    expect(splitGrepScope("/repo/**/")).toMatchObject({
      globSuffix: "**/",
      endsWithSeparator: true,
    });
  });
});

describe("host scope normalization", () => {
  it("resolves parent segments before admission", () => {
    expect(normalizeHostScope("/home/u/repo/../../../etc/**")).toBe("/etc/**");
  });

  it("collapses repeated separators and keeps a trailing one", () => {
    expect(normalizeHostScope("/home/u//repo/")).toBe("/home/u/repo/");
    expect(normalizeHostScope("/home/u/repo")).toBe("/home/u/repo");
    expect(normalizeHostScope("/")).toBe("/");
  });
});

describe("grep glob matching", () => {
  it("matches a recursive markdown suffix", () => {
    const glob = compileGlob("**/*.md");
    expect(glob.matchesFile("notes/a.md")).toBe(true);
    expect(glob.matchesFile("a.md")).toBe(true);
    expect(glob.matchesFile("notes/other.txt")).toBe(false);
    expect(glob.matchesFile("notes/deep/a.md")).toBe(true);
  });

  it("keeps a single-star segment inside its directory", () => {
    const glob = compileGlob("*.md");
    expect(glob.matchesFile("a.md")).toBe(true);
    expect(glob.matchesFile("dir/a.md")).toBe(false);
    expect(glob.mayDescend("")).toBe(true);
    expect(glob.mayDescend("dir")).toBe(false);
    expect(glob.mayDescend("dir/deep")).toBe(false);
  });

  it("descends only where the suffix can still match", () => {
    const glob = compileGlob("src/**/*.ts");
    expect(glob.matchesFile("src/a/b.ts")).toBe(true);
    expect(glob.matchesFile("src/a/b.tsx")).toBe(false);
    expect(glob.matchesFile("other/a.ts")).toBe(false);
    expect(glob.mayDescend("src")).toBe(true);
    expect(glob.mayDescend("src/a")).toBe(true);
    expect(glob.mayDescend("other")).toBe(false);
  });

  it("matches exactly one character for ?", () => {
    const glob = compileGlob("?.md");
    expect(glob.matchesFile("a.md")).toBe(true);
    expect(glob.matchesFile("ab.md")).toBe(false);
  });

  it("never lets a star cross a separator", () => {
    const glob = compileGlob("a*b");
    expect(glob.matchesFile("axxb")).toBe(true);
    expect(glob.matchesFile("a/b")).toBe(false);
  });

  it("treats a whole-segment ** as zero or more segments", () => {
    const glob = compileGlob("**");
    expect(glob.matchesFile("a")).toBe(true);
    expect(glob.matchesFile("a/b/c")).toBe(true);
    expect(glob.mayDescend("a")).toBe(true);
    expect(compileGlob("**/").matchesFile("a/b")).toBe(true);
  });

  it("matches a literal suffix only for that name", () => {
    const glob = compileGlob("a.md");
    expect(glob.matchesFile("a.md")).toBe(true);
    expect(glob.matchesFile("b.md")).toBe(false);
    expect(glob.mayDescend("a.md")).toBe(false);
  });
});
