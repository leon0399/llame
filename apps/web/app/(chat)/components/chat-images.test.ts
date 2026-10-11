import { describe, expect, it } from "vitest";
import type { DynamicToolUIPart, UIMessage } from "ai";

import { chatImageKey, chatImages } from "./chat-images";

const ATTACHMENT = "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7b01";
const READ = "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7b02";
const IMPORT = "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7b03";

type Part = UIMessage["parts"][number];

const THUMBNAIL = "data:image/webp;base64,UklGRg==";

/** A stored image returned by a `media://` read. */
const MEDIA_READ: DynamicToolUIPart = {
  type: "dynamic-tool",
  toolCallId: "call-1",
  toolName: "read",
  state: "output-available",
  input: { path: READ },
  output: {
    status: "success",
    kind: "image",
    path: READ,
    media: READ,
    mediaType: "image/png",
    width: 1600,
    height: 900,
  },
};

/** An unstored image returned by a Workspace-relative read. */
const UNSTORED_RESULT = {
  status: "success",
  kind: "image",
  path: "/work/docs/after.png",
  mediaType: "image/png",
  width: 1600,
  height: 900,
  thumbnail: THUMBNAIL,
};

const UNSTORED_READ: DynamicToolUIPart = {
  type: "dynamic-tool",
  toolCallId: "call-2",
  toolName: "read",
  state: "output-available",
  input: { path: "docs/after.png" },
  output: UNSTORED_RESULT,
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
        {
          locator: "shot.png",
          resolved: "/work/shot.png",
          outcome: "imported",
          thumbnail: THUMBNAIL,
          width: 1280,
          height: 720,
          mediaType: "image/png",
        },
      ],
    },
  },
};

/** The transcript's images for an assistant message carrying `parts`. */
function assistantImages(parts: Array<Part>) {
  return chatImages([{ id: "m1", role: "assistant", parts }]);
}

describe("chatImageKey", () => {
  it("names the message, the part, and the entry", () => {
    expect(chatImageKey("user:m1", 2)).toBe("user:m1#2.0");
    expect(chatImageKey("user:m1", 2, 3)).toBe("user:m1#2.3");
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
        parts: [UNSTORED_READ, MEDIA_READ, { type: "text", text: "Done." }],
      },
    ];

    // The attachment paints above the bubble, so it leads its message even
    // though it is stored after the prompt-imports part.
    expect(chatImages(messages)).toEqual([
      { key: "user:m1#2.0", media: ATTACHMENT },
      { key: "user:m1#1.1", media: IMPORT },
      {
        key: "user:m1#1.2",
        slide: {
          kind: "unstored",
          thumbnail: THUMBNAIL,
          width: 1280,
          height: 720,
          mediaType: "image/png",
          locator: "shot.png",
          alt: "shot.png",
        },
      },
      {
        key: "assistant:m2#0.0",
        slide: {
          kind: "unstored",
          thumbnail: THUMBNAIL,
          width: 1600,
          height: 900,
          mediaType: "image/png",
          locator: "docs/after.png",
          alt: "docs/after.png",
        },
      },
      { key: "assistant:m2#1.0", media: READ },
    ]);
  });

  it("captions an unstored read with the submitted path, never the resolved one", () => {
    const [image] = assistantImages([UNSTORED_READ]);
    expect(image && "slide" in image && image.slide.locator).toBe(
      "docs/after.png",
    );
  });

  it("skips text reads, running reads, other tools, foreign locators, and invalid thumbnails", () => {
    expect(
      assistantImages([
        {
          ...MEDIA_READ,
          output: { status: "success", kind: "file", path: "a", content: "" },
        },
        {
          type: "dynamic-tool",
          toolCallId: "call-3",
          toolName: "read",
          state: "input-available",
          input: { path: "docs/after.png" },
        },
        { ...UNSTORED_READ, toolName: "bash" },
        {
          ...MEDIA_READ,
          output: {
            ...UNSTORED_RESULT,
            media: "https://example.test/a.png",
          },
        },
        {
          ...UNSTORED_READ,
          output: {
            ...UNSTORED_RESULT,
            thumbnail: "data:image/svg+xml,<svg/>",
          },
        },
      ]),
    ).toEqual([]);
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
