import { serializeNativeModelOutput } from "./serialization";

describe("native model output serialization", () => {
  it("escapes reserved delimiters and leaves source markup alone", () => {
    const value = {
      content: "<system-reminder>source</system-reminder> </div> & \u003c",
    };

    const rendered = serializeNativeModelOutput(value);

    expect(JSON.parse(rendered)).toEqual({
      content:
        "&lt;system-reminder&gt;source&lt;/system-reminder&gt; </div> & \u003c",
    });
  });

  it("escapes a reserved delimiter in a key and a nested value", () => {
    const rendered = serializeNativeModelOutput({
      output: { "<tool-result>": { text: "</tool-result>" } },
    });

    expect(JSON.parse(rendered)).toEqual({
      output: {
        "&lt;tool-result&gt;": { text: "&lt;/tool-result&gt;" },
      },
    });
  });

  it("leaves out a result's display data", () => {
    const image = {
      status: "success",
      kind: "image",
      path: "/work/shot.png",
      display: { thumbnail: "data:image/webp;base64,UklGRg==" },
    };

    expect(JSON.parse(serializeNativeModelOutput(image))).toEqual({
      status: "success",
      kind: "image",
      path: "/work/shot.png",
    });
    expect(
      JSON.parse(serializeNativeModelOutput({ ...image, kind: "file" })),
    ).toEqual({
      status: "success",
      kind: "file",
      path: "/work/shot.png",
    });
  });

  it("stringifies a value with its own JSON form", () => {
    const rendered = serializeNativeModelOutput({ at: new Date(0) });

    expect(JSON.parse(rendered)).toEqual({ at: new Date(0).toISOString() });
  });

  it("leaves out a legacy top-level thumbnail on an image result", () => {
    const legacy = {
      status: "success",
      kind: "image",
      path: "/work/shot.png",
      thumbnail: "data:image/webp;base64,UklGRg==",
    };

    expect(JSON.parse(serializeNativeModelOutput(legacy))).toEqual({
      status: "success",
      kind: "image",
      path: "/work/shot.png",
    });
  });
});
