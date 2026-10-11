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

  it("leaves out an image result's thumbnail, and only an image result's", () => {
    const image = {
      status: "success",
      kind: "image",
      path: "/work/shot.png",
      thumbnail: "data:image/webp;base64,UklGRg==",
    };

    expect(JSON.parse(serializeNativeModelOutput(image))).toEqual({
      status: "success",
      kind: "image",
      path: "/work/shot.png",
    });
    expect(
      JSON.parse(serializeNativeModelOutput({ ...image, kind: "file" })),
    ).toEqual({ ...image, kind: "file" });
  });
});
