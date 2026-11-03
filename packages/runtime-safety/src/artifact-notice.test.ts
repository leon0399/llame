import { describe, expect, it } from "vitest";

import { artifactNotice } from "./index";

describe("artifactNotice", () => {
  it("names one part with its line count and no continuation", () => {
    expect(
      artifactNotice([{ locator: "artifact://bash-5/stdout", lines: 5000 }]),
    ).toBe("[full result: artifact://bash-5/stdout (5000 lines)]");
  });

  it("reads a single line as `1 line`", () => {
    expect(artifactNotice([{ locator: "artifact://grep-7", lines: 1 }])).toBe(
      "[full result: artifact://grep-7 (1 line)]",
    );
  });

  it("joins two parts with a comma", () => {
    expect(
      artifactNotice([
        { locator: "artifact://bash-5/stdout", lines: 12 },
        { locator: "artifact://bash-5/stderr", lines: 3 },
      ]),
    ).toBe(
      "[full result: artifact://bash-5/stdout (12 lines), artifact://bash-5/stderr (3 lines)]",
    );
  });

  it("continues from the next artifact line when asked", () => {
    expect(
      artifactNotice([{ locator: "artifact://grep-7", lines: 4812 }], {
        continueWith: { locator: "artifact://grep-7", next: 201 },
      }),
    ).toBe(
      "[full result: artifact://grep-7 (4812 lines); continue with artifact://grep-7:201-]",
    );
  });

  it("renders a line break in a value as one space", () => {
    expect(
      artifactNotice([{ locator: "artifact://a-1\nb", lines: 2 }], {
        continueWith: { locator: "artifact://a-1", next: 3 },
      }),
    ).toBe(
      "[full result: artifact://a-1 b (2 lines); continue with artifact://a-1:3-]",
    );
  });

  it("renders a CRLF in a value as one space", () => {
    expect(artifactNotice([{ locator: "artifact://a-1\r\nb", lines: 2 }])).toBe(
      "[full result: artifact://a-1 b (2 lines)]",
    );
  });

  it("renders the Unicode line and paragraph separators as spaces", () => {
    expect(
      artifactNotice([{ locator: "artifact://a-1\u2028b\u2029c", lines: 2 }]),
    ).toBe("[full result: artifact://a-1 b c (2 lines)]");
  });

  it("names the host directory of a call on this host", () => {
    expect(
      artifactNotice([{ locator: "artifact://bash-5/stdout", lines: 5000 }], {
        hostFiles: {
          directory: "/tmp/llame/chats/c/artifacts/bash-5",
          elsewhere: false,
          readable: false,
        },
      }),
    ).toBe(
      "[full result: artifact://bash-5/stdout (5000 lines); host files in /tmp/llame/chats/c/artifacts/bash-5]",
    );
  });

  it("says the llame host only when read is a route", () => {
    expect(
      artifactNotice([{ locator: "artifact://grep-7", lines: 3 }], {
        continueWith: { locator: "artifact://grep-7", next: 2 },
        hostFiles: {
          directory: "/tmp/llame/chats/c/artifacts",
          elsewhere: true,
          readable: true,
        },
      }),
    ).toBe(
      "[full result: artifact://grep-7 (3 lines); continue with artifact://grep-7:2-; host files on the llame host only]",
    );
  });

  it("names the directory with the llame-host qualifier when read is not a route", () => {
    expect(
      artifactNotice([{ locator: "artifact://bash-5/stdout", lines: 2 }], {
        hostFiles: {
          directory: "/tmp/llame/chats/c/artifacts/bash-5",
          elsewhere: true,
          readable: false,
        },
      }),
    ).toBe(
      "[full result: artifact://bash-5/stdout (2 lines); host files in /tmp/llame/chats/c/artifacts/bash-5 on the llame host]",
    );
  });

  it("keeps a line break in the host directory on one line", () => {
    expect(
      artifactNotice([{ locator: "artifact://a-1", lines: 1 }], {
        hostFiles: {
          directory: "/tmp/a\nb",
          elsewhere: false,
          readable: false,
        },
      }),
    ).toBe("[full result: artifact://a-1 (1 line); host files in /tmp/a b]");
  });
});
