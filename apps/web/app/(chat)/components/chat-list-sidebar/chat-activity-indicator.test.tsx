// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  ChatActivityIndicator,
  resolveChatActivityStatus,
} from "./chat-activity-indicator";

afterEach(() => {
  cleanup();
});

describe("resolveChatActivityStatus", () => {
  it("is null when neither signal is set (idle chat)", () => {
    expect(
      resolveChatActivityStatus({ processing: false, unread: false }),
    ).toBeNull();
  });

  it("is 'unread' when only the unread signal is set", () => {
    expect(resolveChatActivityStatus({ processing: false, unread: true })).toBe(
      "unread",
    );
  });

  it("is 'processing' when only the processing signal is set", () => {
    expect(resolveChatActivityStatus({ processing: true, unread: false })).toBe(
      "processing",
    );
  });

  it("prefers 'processing' when both signals are set — a generating reply isn't unread yet", () => {
    expect(resolveChatActivityStatus({ processing: true, unread: true })).toBe(
      "processing",
    );
  });
});

describe("ChatActivityIndicator", () => {
  it("renders nothing for a null status", () => {
    const { container } = render(<ChatActivityIndicator status={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the unread badge", () => {
    render(<ChatActivityIndicator status="unread" />);
    expect(screen.getByLabelText("Unread reply")).toBeTruthy();
  });

  it("renders the processing badge (spinner ring)", () => {
    render(<ChatActivityIndicator status="processing" />);
    const badge = screen.getByLabelText("Generating response");
    expect(badge).toBeTruthy();
    expect(badge.className).toContain("animate-spin");
  });
});
