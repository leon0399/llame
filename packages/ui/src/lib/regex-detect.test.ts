import { describe, expect, it } from "vitest";

import { findRegexCandidates } from "./regex-detect.js";

const sources = (text: string) =>
  findRegexCandidates(text).map((candidate) => candidate.source);

describe("findRegexCandidates", () => {
  it("finds a slash-delimited literal in prose", () => {
    expect(sources("try /^[a-z0-9]+(?:-[a-z0-9]+)*$/ here")).toEqual([
      "/^[a-z0-9]+(?:-[a-z0-9]+)*$/",
    ]);
  });

  it("captures flags and offsets", () => {
    const [candidate] = findRegexCandidates(String.raw`use /\s+/gi to split`);
    expect(candidate).toMatchObject({
      source: "/\\s+/gi",
      pattern: "\\s+",
      flags: "gi",
      start: 4,
      end: 11,
    });
  });

  it("finds a literal inside code", () => {
    expect(sources(String.raw`input.replace(/\s+/g, " ")`)).toEqual([
      String.raw`/\s+/g`,
    ]);
  });

  it("keeps a slash inside a character class", () => {
    expect(sources(String.raw`const SEP = /[/\\]+/g;`)).toEqual([
      String.raw`/[/\\]+/g`,
    ]);
  });

  it("finds several literals on separate lines", () => {
    expect(
      sources("a /^\\d+$/ b\nconst SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;"),
    ).toEqual([String.raw`/^\d+$/`, "/^[a-z0-9]+(?:-[a-z0-9]+)*$/"]);
  });

  it("leaves division alone", () => {
    expect(sources("return width / height / 2;")).toEqual([]);
  });

  it("leaves chained division alone", () => {
    expect(sources("const x = total / count / 2 + offset / 3;")).toEqual([]);
  });

  it("leaves file paths alone", () => {
    expect(sources("see /home/user/projects/file.ts")).toEqual([]);
  });

  it("leaves URLs alone", () => {
    expect(sources("visit https://example.com/path?q=1 now")).toEqual([]);
  });

  it("leaves dates alone", () => {
    expect(sources("on 01/02/2026 we shipped")).toEqual([]);
  });

  it("leaves and/or alone", () => {
    expect(sources("either and/or both")).toEqual([]);
  });

  it("leaves // comments alone", () => {
    expect(sources("// Path separators, both kinds.")).toEqual([]);
  });

  it("requires a strong metachar, not just a dot", () => {
    expect(sources("open /example.com/ maybe")).toEqual([]);
  });

  it("rejects a literal that does not compile", () => {
    expect(sources("const RANGE = /(unclosed/;")).toEqual([]);
  });

  it("rejects duplicate flags", () => {
    expect(sources("bad /a+/gg here")).toEqual([]);
  });

  it("rejects a flags run glued to a word", () => {
    expect(sources("get /to+/instantly")).toEqual([]);
  });

  it("does not span lines", () => {
    expect(sources("start /abc+\ndef/ end")).toEqual([]);
  });

  it("recovers when an earlier opener never closes", () => {
    expect(sources("a /[ b /x*/ c")).toEqual(["/x*/"]);
  });

  it("ignores an empty body", () => {
    expect(sources("a // b")).toEqual([]);
  });
});
