// @vitest-environment jsdom

/**
 * Coverage for the overflow-sync effect (useTitleOverflowSync/syncTitleOverflow
 * /writeScroll) — pure DOM-measurement logic, not render/interaction, so it
 * stays here rather than in a story per docs/testing.md rule 5. jsdom ships no
 * ResizeObserver and always reports 0 for clientWidth/scrollWidth, so both are
 * stubbed locally per test to exercise the clipped/unclipped branches; that
 * stub is the seam, not a first-party module mock.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SidebarRowTitle } from "./sidebar-row-title";

type ResizeCallback = () => void;

class FakeResizeObserver {
  static instances: Array<FakeResizeObserver> = [];
  callback: ResizeCallback;
  observed: Array<Element> = [];

  constructor(callback: ResizeCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  disconnect() {
    // no-op: nothing in these tests asserts disconnect was called.
  }

  fire() {
    this.callback();
  }
}

/** `syncTitleOverflow` reads scrollWidth off the TEXT node and clientWidth
 * off the CLIP node — jsdom always reports 0 for both, so each is stubbed
 * on its actual owner. */
function stubOverflow(
  clip: HTMLElement,
  textNode: HTMLElement,
  clientWidth: number,
  scrollWidth: number,
) {
  Object.defineProperty(clip, "clientWidth", {
    configurable: true,
    value: clientWidth,
  });
  Object.defineProperty(textNode, "scrollWidth", {
    configurable: true,
    value: scrollWidth,
  });
}

/** The clip span (clipRef) is always the text span's (textRef) direct
 * parent — see SidebarRowTitle's own two nested <span>s. */
function clipSpanOf(textNode: HTMLElement): HTMLElement {
  // SAFETY: see comment above — the text span never renders without its
  // clip-span parent.
  return textNode.parentElement as HTMLElement;
}

/** ResizeObserver only where a test needs it — jsdom already lacks it by
 * default, which is itself the case the first test below exercises. */
function stubResizeObserver() {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
}

beforeEach(() => {
  // jsdom ships no matchMedia at all; useTypewriter's reduced-motion read
  // (an unrelated external boundary this component composes) needs a stub
  // to mount, not to animate — animateChanges stays off in every test here.
  // Only the members useTypewriter actually reads are implemented — narrower
  // than the real MediaQueryList, which vi.stubGlobal doesn't require.
  function fakeMatchMedia(media: string) {
    return {
      matches: false,
      media,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }
  vi.stubGlobal("matchMedia", fakeMatchMedia);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("SidebarRowTitle", () => {
  it("renders the text plainly and does nothing without a ResizeObserver", () => {
    render(<SidebarRowTitle text="Untitled chat" />);

    const clip = clipSpanOf(screen.getByText("Untitled chat"));
    expect(clip.dataset.clipped).toBeUndefined();
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });

  it("warns in development when rendered outside a SidebarMenuItem row", () => {
    stubResizeObserver();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<SidebarRowTitle text="Loose title" />);

    expect(FakeResizeObserver.instances).toHaveLength(1);
    FakeResizeObserver.instances[0]!.fire();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("must render inside a SidebarMenuItem"),
    );
    warn.mockRestore();
  });

  it("marks clipped=true and writes the marquee custom properties when the title overflows", () => {
    stubResizeObserver();
    render(
      <div data-sidebar="menu-item">
        <SidebarRowTitle text="A very long chat title that overflows" />
      </div>,
    );

    const textNode = screen.getByText("A very long chat title that overflows");
    const clip = clipSpanOf(textNode);
    stubOverflow(clip, textNode, 100, 180);

    expect(FakeResizeObserver.instances).toHaveLength(1);
    FakeResizeObserver.instances[0]!.fire();

    expect(clip.dataset.clipped).toBe("true");
    expect(textNode.dataset.clipped).toBe("true");
    expect(clip.style.getPropertyValue("--marquee-x")).toBe("-80px");
    expect(clip.title).toBe("A very long chat title that overflows");
  });

  it("marks clipped=false and clears the title when the title fits", () => {
    stubResizeObserver();
    render(
      <div data-sidebar="menu-item">
        <SidebarRowTitle text="Fits fine" />
      </div>,
    );

    const textNode = screen.getByText("Fits fine");
    const clip = clipSpanOf(textNode);
    stubOverflow(clip, textNode, 200, 120);

    FakeResizeObserver.instances[0]!.fire();

    expect(clip.dataset.clipped).toBe("false");
    expect(clip.title).toBe("");
  });

  it("applies the shimmer class to the inner text span when shimmer is set", () => {
    render(<SidebarRowTitle text="Generating…" shimmer />);

    const textNode = screen.getByText("Generating…");
    expect(textNode.className).toContain("shimmer");
  });
});
