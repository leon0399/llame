import { describe, expect, it } from "vitest";
import type { DynamicToolUIPart, UIMessage } from "ai";

import { chatImageKey, chatImages, readImageLocator } from "./chat-images";

const ATTACHMENT = "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7b01";
const READ = "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7b02";
const IMPORT = "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7b03";

type Part = UIMessage["parts"][number];

const IMAGE_RESULT = {
  status: "success",
  kind: "image",
  path: "/work/after.png",
  media: READ,
  mediaType: "image/png",
  width: 1600,
  height: 900,
};

const IMAGE_READ: DynamicToolUIPart = {
  type: "dynamic-tool",
  toolCallId: "call-1",
  toolName: "read",
  state: "output-available",
  input: { path: "/work/after.png" },
  output: IMAGE_RESULT,
};

const PROMPT_IMPORTS: Part = {
  type: "data-context",
  data: {
    v: 1,
    producer: "prompt-imports",
    form: "notice",
    runId: "11111111-1111-4111-8111-111111111111",
    payload: {
      imports: [
        { locator: "notes.md", outcome: "imported" },
        { locator: "before.webp", outcome: "imported", media: IMPORT },
      ],
    },
  },
};

describe("chatImageKey", () => {
  it("names the message, the part, and the entry", () => {
    expect(chatImageKey("user:m1", 2)).toBe("user:m1#2.0");
    expect(chatImageKey("user:m1", 2, 3)).toBe("user:m1#2.3");
  });
});

describe("readImageLocator", () => {
  it("returns the locator of a completed image read", () => {
    expect(readImageLocator(IMAGE_READ)).toBe(READ);
  });

  it("ignores text reads, running reads, other tools, and foreign locators", () => {
    expect(
      readImageLocator({
        ...IMAGE_READ,
        output: { status: "success", kind: "file", path: "a", content: "" },
      }),
    ).toBeNull();
    expect(
      readImageLocator({
        type: "dynamic-tool",
        toolCallId: "call-2",
        toolName: "read",
        state: "input-available",
        input: { path: "/work/after.png" },
      }),
    ).toBeNull();
    expect(readImageLocator({ ...IMAGE_READ, toolName: "bash" })).toBeNull();
    expect(
      readImageLocator({
        ...IMAGE_READ,
        output: { ...IMAGE_RESULT, media: "https://example.test/a.png" },
      }),
    ).toBeNull();
  });
});

describe("chatImages", () => {
  it("lists attachments, read results, and prompt imports in transcript order", () => {
    const messages: Array<UIMessage> = [
      {
        id: "m1",
        role: "user",
        parts: [
          { type: "text", text: "Compare @before.webp with this" },
          PROMPT_IMPORTS,
          { type: "file", mediaType: "image/jpeg", url: ATTACHMENT },
        ],
      },
      {
        id: "m2",
        role: "assistant",
        parts: [IMAGE_READ, { type: "text", text: "Done." }],
      },
    ];

    // The attachment paints above the bubble, so it leads its message even
    // though it is stored after the prompt-imports part.
    expect(chatImages(messages)).toEqual([
      { key: "user:m1#2.0", locator: ATTACHMENT },
      { key: "user:m1#1.1", locator: IMPORT },
      { key: "assistant:m2#0.0", locator: READ },
    ]);
  });

  it("skips file parts without a media locator and assistant file parts", () => {
    const messages: Array<UIMessage> = [
      {
        id: "m1",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            url: "data:image/png;base64,AA==",
          },
        ],
      },
      {
        id: "m2",
        role: "assistant",
        parts: [{ type: "file", mediaType: "image/png", url: ATTACHMENT }],
      },
    ];
    expect(chatImages(messages)).toEqual([]);
  });
});
