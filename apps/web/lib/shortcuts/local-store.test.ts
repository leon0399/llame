// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createLocalStore } from "./local-store";

describe("createLocalStore", () => {
  it("keeps hearing other tabs after one of two subscribers leaves", () => {
    const store = createLocalStore("local-store-test", z.number(), 0);
    const leaving = vi.fn();
    const staying = vi.fn();

    const unsubscribe = store.subscribe(leaving);

    store.subscribe(staying);
    unsubscribe();

    window.dispatchEvent(
      new StorageEvent("storage", { key: "local-store-test" }),
    );

    expect(staying).toHaveBeenCalledOnce();
    expect(leaving).not.toHaveBeenCalled();
  });

  it("re-reads a value another tab wrote while nothing subscribed", () => {
    const store = createLocalStore("local-store-unwatched", z.number(), 0);

    expect(store.getSnapshot()).toBe(0);

    window.localStorage.setItem("local-store-unwatched", "2");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "local-store-unwatched" }),
    );

    expect(store.getSnapshot()).toBe(2);
  });
});
