import { describe, expect, it } from "vitest";

import {
  renderCollectedDirectory,
  type DirectoryListingEntry,
} from "./collected-directory";

describe("collected directory listing", () => {
  it("renders a tree with a caller display path", () => {
    const entries: ReadonlyArray<DirectoryListingEntry> = [
      {
        name: "src",
        kind: "directory",
        children: [{ name: "index.ts", kind: "file" }],
      },
      { name: "README.md", kind: "file" },
    ];

    expect(
      renderCollectedDirectory("/workspace", entries, {
        displayPath: "repo://workspace",
      }),
    ).toEqual({
      status: "success",
      kind: "directory",
      path: "repo://workspace",
      content: "repo://workspace\n  - src/\n    - index.ts\n  - README.md\n",
      truncated: false,
    });
  });

  it("renders a selected flat slice", () => {
    const result = renderCollectedDirectory(
      "/workspace",
      [
        { name: "b", kind: "file" },
        { name: "a", kind: "file" },
      ],
      { offset: 1, limit: 1 },
    );

    expect(result).toEqual({
      status: "success",
      kind: "directory",
      path: "/workspace",
      content: "/workspace\n  - b\n",
      truncated: false,
    });
  });

  it("rejects a root beyond the traversal budget", () => {
    const entries = Array.from({ length: 10_001 }, (_, index) => ({
      name: `file-${index}`,
      kind: "file" as const,
    }));

    expect(renderCollectedDirectory("/workspace", entries)).toEqual({
      status: "error",
      type: "directory_too_large",
      message:
        "Directory contains 10001 entries, exceeding the 10000 entry budget.",
      count: 10_001,
    });
  });

  it("uses host markers for links and special entries", () => {
    expect(
      renderCollectedDirectory("/workspace", [
        { name: "link", kind: "symlink" },
        { name: "pipe", kind: "special" },
      ]),
    ).toMatchObject({
      status: "success",
      content: "/workspace\n  - link@\n  - pipe?\n",
    });
  });
});
