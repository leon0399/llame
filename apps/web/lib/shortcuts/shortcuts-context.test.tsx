// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ShortcutsProvider,
  useShortcut,
  useShortcutHint,
  useShortcutSettings,
} from "./shortcuts-context";

// jsdom reports no platform, so the primary modifier is Ctrl.
function press(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });

  act(() => {
    document.dispatchEvent(event);
  });

  return event;
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <ShortcutsProvider>{children}</ShortcutsProvider>;
}

describe("ShortcutsProvider", () => {
  afterEach(() => {
    // Every mounted provider owns a document listener; unmount them all.
    cleanup();
    const { result, unmount } = renderHook(useShortcutSettings, { wrapper });

    act(() => {
      result.current.resetAll();
      result.current.clearUsage();
    });
    unmount();
  });

  it("runs the handler on the chord, prevents the default and counts the use", () => {
    const handler = vi.fn();

    const { result } = renderHook(
      () => {
        useShortcut("palette.toggle", handler);

        return useShortcutSettings();
      },
      { wrapper },
    );

    const event = press({ key: "k", ctrlKey: true });

    expect(handler).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(
      result.current.rows.find((row) => row.def.id === "palette.toggle")?.usage
        ?.count,
    ).toBe(1);
  });

  it("leaves a declined event untouched and uncounted", () => {
    const { result } = renderHook(
      () => {
        useShortcut("run.stop", () => false);

        return useShortcutSettings();
      },
      { wrapper },
    );

    const event = press({ key: "Escape" });

    expect(event.defaultPrevented).toBe(false);
    expect(
      result.current.rows.find((row) => row.def.id === "run.stop")?.usage,
    ).toBeUndefined();
  });

  it("ignores a held chord's auto-repeat and a disabled handler", () => {
    const handler = vi.fn();

    renderHook(() => useShortcut("chat.new", handler, false), { wrapper });
    press({ key: "o", ctrlKey: true, shiftKey: true });

    const live = vi.fn();

    renderHook(() => useShortcut("chat.new", live), { wrapper });
    press({ key: "o", ctrlKey: true, shiftKey: true, repeat: true });

    expect(handler).not.toHaveBeenCalled();
    expect(live).not.toHaveBeenCalled();
  });

  it("follows a rebinding, and reports a conflict it creates", () => {
    const handler = vi.fn();

    const { result } = renderHook(
      () => {
        useShortcut("chat.new", handler);

        return {
          settings: useShortcutSettings(),
          hint: useShortcutHint("chat.new"),
        };
      },
      { wrapper },
    );

    act(() =>
      result.current.settings.setBinding("chat.new", { key: "k", mod: true }),
    );

    expect(result.current.hint.label).toBe("Ctrl+K");
    expect(
      result.current.settings.rows
        .find((row) => row.def.id === "chat.new")
        ?.conflicts.map((def) => def.id),
    ).toEqual(["palette.toggle"]);

    press({ key: "o", ctrlKey: true, shiftKey: true });
    expect(handler).not.toHaveBeenCalled();

    press({ key: "k", ctrlKey: true });
    expect(handler).toHaveBeenCalledOnce();
  });
});
