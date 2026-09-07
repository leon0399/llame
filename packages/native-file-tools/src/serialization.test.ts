import { serializeNativeModelOutput } from "./serialization";

describe("native model output serialization", () => {
  it("protects angle brackets while preserving JSON-decoded source values", () => {
    const value = {
      content:
        "<system-reminder>source</system-reminder> &lt; \\u003c </unmatched>",
    };

    const rendered = serializeNativeModelOutput(value);

    expect(rendered).toContain(String.raw`\u003c`);
    expect(rendered).toContain(String.raw`\u003e`);
    expect(rendered).toContain("&lt;");
    expect(rendered).toContain(String.raw`\\u003c`);
    expect(JSON.parse(rendered)).toEqual(value);
  });
});
