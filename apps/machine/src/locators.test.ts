import { describe, expect, it } from "vitest";
import { isInsideRoots, rewriteRootPrefixes } from "./locators";

const PREFIX = "machine://devl";

describe("isInsideRoots", () => {
  it("accepts a root and its children, and refuses a sibling", () => {
    const roots = ["/srv/app", "/opt/data"];

    expect(isInsideRoots(roots, "/srv/app")).toBe(true);
    expect(isInsideRoots(roots, "/srv/app/trees/shop")).toBe(true);
    expect(isInsideRoots(roots, "/opt/data")).toBe(true);
    expect(isInsideRoots(roots, "/srv/application")).toBe(false);
    expect(isInsideRoots(roots, "/srv/app+1")).toBe(false);
    expect(isInsideRoots(roots, "/srv")).toBe(false);
  });

  it("accepts every absolute path under the root /", () => {
    expect(isInsideRoots(["/"], "/home/me/x")).toBe(true);
    expect(isInsideRoots(["/"], "/")).toBe(true);
  });
});

describe("rewriteRootPrefixes", () => {
  it("rewrites a whole-path root occurrence, and the longest root first", () => {
    expect(
      rewriteRootPrefixes(
        "fatal: '/home/me/work/app/.git' is not a repository",
        ["/home/me", "/home/me/work"],
        PREFIX,
      ),
    ).toBe(`fatal: '${PREFIX}/home/me/work/app/.git' is not a repository`);
  });

  it("leaves a sibling whose name continues the root text alone", () => {
    expect(
      rewriteRootPrefixes(
        "/srv/app+1/x and /srv/app@2/y and /srv/application/z",
        ["/srv/app"],
        PREFIX,
      ),
    ).toBe("/srv/app+1/x and /srv/app@2/y and /srv/application/z");
  });

  it("rewrites a path that ends the root, is quoted, or is delimited", () => {
    expect(
      rewriteRootPrefixes(
        "/srv/app '/srv/app' \"/srv/app\" /srv/app:2 /srv/app, /srv/app)",
        ["/srv/app"],
        PREFIX,
      ),
    ).toBe(
      `${PREFIX}/srv/app '${PREFIX}/srv/app' "${PREFIX}/srv/app" ` +
        `${PREFIX}/srv/app:2 ${PREFIX}/srv/app, ${PREFIX}/srv/app)`,
    );
  });

  it("rewrites a bare host path under the root /", () => {
    expect(
      rewriteRootPrefixes("fatal: '/home/me/x' already exists", ["/"], PREFIX),
    ).toBe(`fatal: '${PREFIX}/home/me/x' already exists`);
    expect(rewriteRootPrefixes("/home/me/x and a/b", ["/"], PREFIX)).toBe(
      `${PREFIX}/home/me/x and a/b`,
    );
  });
});
