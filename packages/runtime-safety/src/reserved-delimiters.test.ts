import {
  neutralizeReservedDelimiters,
  neutralizeReservedDelimitersDeep,
  RESERVED_DELIMITER_NAMES,
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
