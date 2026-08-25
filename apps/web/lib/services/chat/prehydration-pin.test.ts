// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAT_SCROLLER_SELECTOR,
  PREHYDRATION_PIN_SCRIPT,
} from "./prehydration-pin";

describe("PREHYDRATION_PIN_SCRIPT", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    delete window.__llameChatPinStop;
    delete window.__llameChatPinEscaped;
  });

  afterEach(() => {
    window.__llameChatPinStop?.();
    delete window.__llameChatPinStop;
    delete window.__llameChatPinEscaped;
    vi.useRealTimers();
  });

  function mountScroller() {
    const log = document.createElement("div");
    log.setAttribute("role", "log");
    const scroller = document.createElement("div");
    Object.defineProperty(scroller, "scrollHeight", { value: 2000 });
    Object.defineProperty(scroller, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    log.append(scroller);
    document.body.append(log);
    return scroller;
  }

  function runScript() {
    // The shipped inline script string is the unit under test.
    (0, eval)(PREHYDRATION_PIN_SCRIPT);
  }

  it("sets __llameChatPinEscaped when the reader wheels before hydration", () => {
    mountScroller();
    runScript();

    expect(window.__llameChatPinEscaped).toBeUndefined();
    window.dispatchEvent(new Event("wheel", { bubbles: true }));
    expect(window.__llameChatPinEscaped).toBe(true);
  });

  it("does not set __llameChatPinEscaped when React retires the pin", () => {
    mountScroller();
    runScript();

    window.__llameChatPinStop?.();
    expect(window.__llameChatPinEscaped).toBeUndefined();
  });

  it("escapes on scroll keys, not composer typing", () => {
    mountScroller();
    runScript();

    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true }),
    );
    expect(window.__llameChatPinEscaped).toBeUndefined();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(window.__llameChatPinEscaped).toBe(true);
  });

  it("pins the scroller matching CHAT_SCROLLER_SELECTOR until stopped", async () => {
    const scroller = mountScroller();
    runScript();

    expect(document.querySelector(CHAT_SCROLLER_SELECTOR)).toBe(scroller);
    expect(scroller.scrollTop).toBe(2000);

    // Positive: a mutation before escape re-pins.
    scroller.scrollTop = 50;
    document.body.append(document.createElement("div"));
    await Promise.resolve();
    expect(scroller.scrollTop).toBe(2000);

    scroller.scrollTop = 100;
    window.dispatchEvent(new Event("wheel", { bubbles: true }));
    // A later mutation must not re-pin after user escape.
    document.body.append(document.createElement("div"));
    await Promise.resolve();
    expect(scroller.scrollTop).toBe(100);
  });
});
