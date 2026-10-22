import { appendGrepFile, createGrepPage } from "./page";

describe("grep page cuts", () => {
  it("keeps the twentieth-passage flag when it cuts the first passage", () => {
    const page = createGrepPage();
    appendGrepFile(page, 10, {
      scopeIndex: 0,
      rel: "a.md",
      fileLocator: "/repo/a.md",
      passages: [
        { locator: "/repo/a.md:40-40", content: "40: hit", matches: [40] },
      ],
      cappedAt: 40,
    });
    expect(page.results).toHaveLength(1);
    expect(page.results[0].truncated).toBe(true);
    expect(page.full).toBe(true);
    expect(page.last).toMatchObject({
      startLine: 40,
      endLine: 40,
      capped: true,
    });
  });
});
