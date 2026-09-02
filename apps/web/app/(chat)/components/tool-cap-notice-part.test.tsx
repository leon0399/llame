// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { toChatUiMessages } from "@/lib/services/chat/history";

import { parseCapNoticePart, ToolCapNoticePart } from "./tool-cap-notice-part";

afterEach(() => {
  cleanup();
});

describe("parseCapNoticePart", () => {
  it("reads the SDK-native nested data-part shape", () => {
    expect(
      parseCapNoticePart({
        type: "data-cap-notice",
        data: { stepsUsed: 8, maxSteps: 8 },
      }),
    ).toEqual({ stepsUsed: 8, maxSteps: 8 });
  });

  it("falls back to a flat shape if the fields sit directly on the part", () => {
    expect(
      parseCapNoticePart({
        type: "data-cap-notice",
        stepsUsed: 3,
        maxSteps: 8,
      }),
    ).toEqual({ stepsUsed: 3, maxSteps: 8 });
  });

  it("returns null when required fields are missing or non-numeric, rather than rendering a broken chip", () => {
    expect(parseCapNoticePart({ type: "data-cap-notice" })).toBeNull();
    expect(
      parseCapNoticePart({
        type: "data-cap-notice",
        data: { stepsUsed: "8", maxSteps: 8 },
      }),
    ).toBeNull();
    expect(parseCapNoticePart(null)).toBeNull();
    expect(parseCapNoticePart("not-an-object")).toBeNull();
  });
});

// The chip's rendered state lives in tool-cap-notice-part.stories.tsx
// (docs/testing.md rule 5); the parity check below stays jsdom because it
// compares two renders' HTML byte-for-byte — not expressible as a story.

describe("live vs. historical rendering parity", () => {
  it("renders the identical cap-notice chip whether the part came from the live stream or a reloaded history response", () => {
    const livePart = {
      type: "data-cap-notice" as const,
      id: "cap-1",
      data: { stepsUsed: 8, maxSteps: 8 },
    };

    const [historyMessage] = toChatUiMessages({
      messages: [
        {
          id: "assistant-message",
          chatId: "chat-1",
          seq: 2,
          role: "assistant",
          senderUserId: null,
          parts: [livePart],
          attachments: [],
          usage: null,
          inReplyTo: "user-message",
          createdAt: "2026-07-11T12:00:00.000Z",
        },
      ],
    });
    const historicalPart = historyMessage?.parts[0];

    const liveData = parseCapNoticePart(livePart);
    const historicalData = parseCapNoticePart(historicalPart);
    expect(historicalData).toEqual(liveData);
    if (!liveData || !historicalData) {
      throw new Error("expected both parses to succeed");
    }

    const liveRender = render(<ToolCapNoticePart {...liveData} />);
    const liveHtml = liveRender.container.innerHTML;
    liveRender.unmount();

    const historicalRender = render(<ToolCapNoticePart {...historicalData} />);
    expect(historicalRender.container.innerHTML).toBe(liveHtml);

    // Parity alone compares two renders to each other, so dropping the counts
    // from the chip would keep both sides equal. Anchor on the literal values.
    expect(historicalRender.container.textContent).toContain(
      `(${String(liveData.stepsUsed)}/${String(liveData.maxSteps)})`,
    );
  });
});
