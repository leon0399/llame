// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { useAutoResizeTextarea } from "./use-autoresize-textarea.js";

// jsdom has no layout: every textarea reports this as its content height.
let contentHeight = 0;

const original = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollHeight",
);

Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
  configurable: true,
  get: () => contentHeight,
});

function Probe({ value }: { value: string }) {
  const ref = useAutoResizeTextarea({ minHeight: 48, maxHeight: 164, value });

  return createElement("textarea", { ref, value, readOnly: true });
}

describe("useAutoResizeTextarea", () => {
  afterEach(() => {
    if (original) {
      Object.defineProperty(
        HTMLTextAreaElement.prototype,
        "scrollHeight",
        original,
      );
    }
  });

  it("shrinks when the controlled value is cleared from code", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    const root = createRoot(host);

    contentHeight = 120;
    act(() => root.render(createElement(Probe, { value: "long message" })));

    const textarea = host.querySelector("textarea");

    expect(textarea?.style.height).toBe("120px");

    // A send clears the value without an input event.
    contentHeight = 20;
    act(() => root.render(createElement(Probe, { value: "" })));

    expect(textarea?.style.height).toBe("48px");
    act(() => root.unmount());
  });
});
