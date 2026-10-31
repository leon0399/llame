import {
  hasEscapedKeyCollision,
  neutralizeReservedDelimiters,
  neutralizeReservedDelimitersDeep,
  RESERVED_DELIMITER_NAMES,
  scanTagTokens,
} from "./reserved-delimiters";

describe("reserved delimiter neutralization", () => {
  it("reserves exactly the packaged fences and structural labels", () => {
    expect([...RESERVED_DELIMITER_NAMES].sort()).toEqual([
      "available_skills",
      "skill",
      "system-reminder",
      "tool-call",
      "tool-result",
      "user_chat_history",
      "user_personalization",
    ]);
  });

  it.each([
    ["an opener", "<system-reminder>"],
    ["a closer", "</tool-result>"],
    ["a padded opener", "< system-reminder >"],
    ["a padded closer", "</TOOL-RESULT >"],
    ["an empty element", "<tool-call/>"],
    ["an attribute-bearing opener", '<skill name="evil">'],
  ])("escapes %s", (_case, token) => {
    expect(neutralizeReservedDelimiters(token)).toBe(
      token.replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    );
  });

  it("escapes an unterminated token that names a reserved delimiter", () => {
    expect(neutralizeReservedDelimiters('<skill foo="')).toBe(
      '&lt;skill foo="',
    );
  });

  it("leaves source markup, prose, and entities byte-for-byte", () => {
    for (const text of [
      "</div>",
      "<p>paragraph</p>",
      "a < b and i<10",
      "<3",
      "&lt;already escaped&gt;",
      "<skillful>",
      "no markup at all",
      "",
    ]) {
      expect(neutralizeReservedDelimiters(text)).toBe(text);
    }
  });

  it("escapes a reserved token inside surrounding text and keeps the rest", () => {
    expect(neutralizeReservedDelimiters("see </tool-result> here")).toBe(
      "see &lt;/tool-result&gt; here",
    );
  });
});

describe("tag token scanning", () => {
  it("walks tokens left to right without overlap", () => {
    expect(
      [...scanTagTokens("a <b> c </d> e")].map(({ token }) => token),
    ).toEqual(["<b>", "</d>"]);
  });

  it("ends a token at a nested opener, at the end, or at a closer", () => {
    expect([...scanTagTokens("<<skill>")].map(({ token }) => token)).toEqual([
      "<",
      "<skill>",
    ]);
    expect([...scanTagTokens("x <skill")]).toEqual([
      { start: 2, end: 8, token: "<skill" },
    ]);
    expect([...scanTagTokens("no markup")]).toEqual([]);
  });

  it("matches what the pattern it replaced matched", () => {
    const pattern = /<[^<>]*>?/gu;
    for (const text of [
      "<a><b>x</b></a>",
      'unterminated <skill foo="x',
      "<a><<b>>",
      "",
      "a < b > c",
    ]) {
      expect([...scanTagTokens(text)].map(({ token }) => token)).toEqual(
        [...text.matchAll(pattern)].map(([token]) => token),
      );
    }
  });
});

describe("escaped key collisions", () => {
  it("reports a key whose escaped spelling already exists", () => {
    expect(
      hasEscapedKeyCollision({
        "<system-reminder>": "authored",
        "&lt;system-reminder&gt;": "escaped",
      }),
    ).toBe(true);
    expect(
      hasEscapedKeyCollision({
        nested: [{ "<skill>": 1, "&lt;skill&gt;": 2 }],
      }),
    ).toBe(true);
  });

  it("reports no collision for escaped keys without a twin", () => {
    expect(hasEscapedKeyCollision({ "<system-reminder>": 1 })).toBe(false);
    expect(hasEscapedKeyCollision({ text: "</div>", list: [1, "x"] })).toBe(
      false,
    );
    expect(hasEscapedKeyCollision("<skill>")).toBe(false);
    expect(hasEscapedKeyCollision(null)).toBe(false);
  });
});

describe("reserved delimiter neutralization over a value", () => {
  it("escapes object keys and nested string values, leaving scalars alone", () => {
    const value = {
      "<system-reminder>": "plain text",
      nested: { text: "<tool-result>done</tool-result>" },
      list: ["</div>", '<skill name="aid">'],
      count: 3,
      ok: true,
      none: null,
    };

    expect(neutralizeReservedDelimitersDeep(value)).toEqual({
      "&lt;system-reminder&gt;": "plain text",
      nested: { text: "&lt;tool-result&gt;done&lt;/tool-result&gt;" },
      list: ["</div>", '&lt;skill name="aid"&gt;'],
      count: 3,
      ok: true,
      none: null,
    });
  });

  it("applies the rule to a top-level string and walks a top-level array", () => {
    expect(neutralizeReservedDelimitersDeep("<tool-result>")).toBe(
      "&lt;tool-result&gt;",
    );
    expect(neutralizeReservedDelimitersDeep(["</div>", "<skill>"])).toEqual([
      "</div>",
      "&lt;skill&gt;",
    ]);
  });

  it("returns non-string scalars untouched", () => {
    for (const value of [7, true, null, undefined]) {
      expect(neutralizeReservedDelimitersDeep(value)).toBe(value);
    }
  });

  it("leaves an object with its own prototype to the serializer", () => {
    const at = new Date(0);
    const walked = neutralizeReservedDelimitersDeep({ at, text: "</div>" });

    expect(walked.at).toBe(at);
    expect(walked.text).toBe("</div>");
  });
});
