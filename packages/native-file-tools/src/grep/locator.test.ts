import { formatPassageLocator, parsePassageLocator } from "./locator";

describe("passage locators", () => {
  it("formats the canonical range spelling", () => {
    expect(formatPassageLocator("notes.md", 5, 10)).toBe("notes.md:L5-10");
    expect(formatPassageLocator("machine://box/srv/a:1.go", 5, 5)).toBe(
      "machine://box/srv/a:1.go:L5-5",
    );
  });

  it("parses the canonical spelling and the stored bare one alike", () => {
    const parsed = { file: "notes.md", startLine: 5, endLine: 10 };

    expect(parsePassageLocator("notes.md:L5-10")).toEqual(parsed);
    expect(parsePassageLocator("notes.md:5-10")).toEqual(parsed);
  });

  it("keeps a colon a path carries on the file side", () => {
    expect(parsePassageLocator("machine://box/srv/a:1.go:5-10")).toEqual({
      file: "machine://box/srv/a:1.go",
      startLine: 5,
      endLine: 10,
    });
  });

  it("reads no passage range from any other suffix", () => {
    for (const locator of [
      "notes.md",
      "notes.md:l5-10",
      "notes.md:L5",
      "notes.md:L5-",
      "notes.md:L5-10,L20-30",
      "notes.md:L5-10:raw",
    ]) {
      expect(parsePassageLocator(locator)).toBeUndefined();
    }
  });
});
