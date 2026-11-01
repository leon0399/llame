import { modelVisibleResult } from "./model-visible";

describe("modelVisibleResult", () => {
  it("removes a display object from any record and keeps the rest", () => {
    const result = {
      status: "success",
      kind: "file",
      content: "text",
      display: { oldText: "a", newText: "b" },
    };
    expect(modelVisibleResult(result)).toEqual({
      status: "success",
      kind: "file",
      content: "text",
    });
  });

  it("leaves a record without display or thumbnail alone", () => {
    const result = { status: "success", content: "text" };
    expect(modelVisibleResult(result)).toEqual(result);
  });

  it("removes a legacy top-level thumbnail from an image result only", () => {
    const image = {
      status: "success",
      kind: "image",
      path: "/work/shot.png",
      thumbnail: "data:image/webp;base64,UklGRg==",
    };
    expect(modelVisibleResult(image)).toEqual({
      status: "success",
      kind: "image",
      path: "/work/shot.png",
    });

    const file = { ...image, kind: "file" };
    expect(modelVisibleResult(file)).toEqual(file);
  });

  it("keeps a thumbnail on a non-image result that also carries display", () => {
    const result = {
      status: "success",
      kind: "file",
      thumbnail: "kept payload",
      display: { oldText: "a" },
    };

    expect(modelVisibleResult(result)).toEqual({
      status: "success",
      kind: "file",
      thumbnail: "kept payload",
    });
  });

  it.each([
    [
      "a nested display record",
      { status: "success", nested: { display: "kept" } },
    ],
    ["a string", "text"],
    ["a number", 4],
    ["null", null],
    ["undefined", undefined],
    ["an array", ["display"]],
  ])("leaves %s unchanged", (_case, value) => {
    expect(modelVisibleResult(value)).toEqual(value);
  });
});
