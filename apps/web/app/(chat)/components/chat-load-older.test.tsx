// @vitest-environment jsdom

/**
 * ChatLoadOlder re-pins the scroller to the bottom synchronously when the
 * transcript's content resizes while stuck. use-stick-to-bottom only chases
 * growth through a requestAnimationFrame-deferred scrollToBottom, so without
 * this every growth at the bottom paints one off-bottom frame first.
 */

import { createRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { StickToBottomContext } from "use-stick-to-bottom";

import {
  Conversation,
  ConversationContent,
} from "@workspace/ui/components/ai-elements/conversation";

import { ChatLoadOlder } from "./chat-load-older";

// jsdom has no ResizeObserver: the library and the component both observe the
// content element, so keep every observer and fire them on demand.
class ResizeObserverStub {
  static readonly instances: Array<ResizeObserverStub> = [];
  readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverStub.instances.push(this);
  }
  observe(_target: Element, _options?: ResizeObserverOptions): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
  fire(entries: Array<ResizeObserverEntry>): void {
    this.callback(entries, this);
  }
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  ResizeObserverStub.instances.length = 0;
});

// jsdom does no layout: give the scroller a scrollable geometry by hand.
function setGeometry(scroller: HTMLElement, scrollHeight: number) {
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(scroller, "clientHeight", {
    configurable: true,
    value: 600,
  });
}

function fireContentResize(content: HTMLElement, height: number) {
  const contentRect: DOMRectReadOnly = {
    x: 0,
    y: 0,
    width: 0,
    height,
    top: 0,
    left: 0,
    right: 0,
    bottom: height,
    toJSON: () => ({}),
  };
  const entry: ResizeObserverEntry = {
    target: content,
    contentRect,
    borderBoxSize: [],
    contentBoxSize: [],
    devicePixelContentBoxSize: [],
  };
  act(() => {
    for (const observer of ResizeObserverStub.instances) observer.fire([entry]);
  });
}

function renderTranscript() {
  const contextRef = createRef<StickToBottomContext>();
  const view = render(
    <>
      <Conversation initial="instant" resize="instant" contextRef={contextRef}>
        <ConversationContent>
          <ChatLoadOlder
            hasOlder={false}
            isLoading={false}
            onLoadOlder={() => {}}
            oldestMessageKey="m-1"
          />
          <div data-message-key="m-1">hello</div>
        </ConversationContent>
      </Conversation>
      <div data-testid="after-transcript">outside</div>
    </>,
  );
  const scroller =
    view.container.querySelector<HTMLElement>('[role="log"] > div');
  if (!scroller) throw new Error("scroller not rendered");
  const content = scroller.firstElementChild;
  if (!(content instanceof HTMLElement)) throw new Error("content missing");
  const outside = view.getByTestId("after-transcript");
  return { scroller, content, contextRef, outside };
}

describe("ChatLoadOlder stick-on-resize", () => {
  it("re-pins to the bottom in the same tick the content grows", () => {
    const { scroller, content } = renderTranscript();
    setGeometry(scroller, 2000);
    scroller.scrollTop = 1400;

    setGeometry(scroller, 2300);
    fireContentResize(content, 2300);

    // The library's own target: scrollHeight - 1 - clientHeight.
    expect(scroller.scrollTop).toBe(2300 - 1 - 600);
  });

  it("leaves a reader who scrolled away alone", () => {
    const { scroller, content, contextRef } = renderTranscript();
    setGeometry(scroller, 2000);
    scroller.scrollTop = 300;
    // stopScroll is the library's own escape: what its wheel/scroll handlers
    // call when the reader deliberately leaves the bottom.
    act(() => {
      contextRef.current?.stopScroll();
    });

    setGeometry(scroller, 2300);
    fireContentResize(content, 2300);

    expect(scroller.scrollTop).toBe(300);
  });

  it("does not yank a reader who is selecting transcript text", () => {
    const { scroller, content } = renderTranscript();
    setGeometry(scroller, 2000);
    scroller.scrollTop = 1400;
    const text = content.querySelector("[data-message-key]")?.firstChild;
    if (!text) throw new Error("message text missing");
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 3);
    const selection = document.getSelection();
    if (!selection) throw new Error("jsdom selection missing");
    selection.removeAllRanges();
    selection.addRange(range);

    setGeometry(scroller, 2300);
    fireContentResize(content, 2300);

    expect(scroller.scrollTop).toBe(1400);
    selection.removeAllRanges();
  });

  it("does not yank a reverse selection from outside into the transcript", () => {
    const { scroller, content, outside } = renderTranscript();
    setGeometry(scroller, 2000);
    scroller.scrollTop = 1400;
    const insideText = content.querySelector("[data-message-key]")?.firstChild;
    const outsideText = outside.firstChild;
    if (!insideText || !outsideText) throw new Error("selection text missing");
    const selection = document.getSelection();
    if (!selection) throw new Error("jsdom selection missing");
    selection.removeAllRanges();
    selection.setBaseAndExtent(outsideText, 7, insideText, 2);

    setGeometry(scroller, 2300);
    fireContentResize(content, 2300);

    expect(selection.anchorNode).toBe(outsideText);
    expect(content.contains(selection.focusNode)).toBe(true);
    expect(scroller.scrollTop).toBe(1400);
    selection.removeAllRanges();
  });
});
