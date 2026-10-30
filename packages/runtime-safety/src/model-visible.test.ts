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

  it("leaves a record without display alone, by reference", () => {
    const result = { status: "success", content: "text" };
    expect(modelVisibleResult(result)).toBe(result);
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
    expect(modelVisibleResult(file)).toBe(file);
  });

  it("leaves a nested display object alone", () => {
    const result = { status: "success", nested: { display: "kept" } };
    expect(modelVisibleResult(result)).toBe(result);
  });

  it("returns non-records unchanged", () => {
    for (const value of ["text", 4, null, undefined, ["display"]]) {
      expect(modelVisibleResult(value)).toBe(value);
    }
  });
});
