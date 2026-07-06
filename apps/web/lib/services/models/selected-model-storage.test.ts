import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readSelectedModel,
  writeSelectedModel,
} from "./selected-model-storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage(): Map<string, string> {
  const map = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    },
  });
  return map;
}

describe("selected-model-storage", () => {
  it("round-trips per user: write then read", () => {
    stubStorage();
    writeSelectedModel("user-1", "anthropic:claude-4-opus");
    expect(readSelectedModel("user-1")).toBe("anthropic:claude-4-opus");
  });

  it("isolates per user (a shared browser must not bleed preferences)", () => {
    stubStorage();
    writeSelectedModel("user-1", "openai:gpt-4o");
    writeSelectedModel("user-2", "xai:grok-3-mini");
    expect(readSelectedModel("user-1")).toBe("openai:gpt-4o");
    expect(readSelectedModel("user-2")).toBe("xai:grok-3-mini");
  });

  it("returns null when nothing is stored for the user", () => {
    stubStorage();
    expect(readSelectedModel("user-1")).toBeNull();
  });

  it("does not persist an empty selection (deselect toggle)", () => {
    stubStorage();
    writeSelectedModel("user-1", "openai:gpt-4o");
    writeSelectedModel("user-1", ""); // deselect
    expect(readSelectedModel("user-1")).toBe("openai:gpt-4o"); // last real choice kept
  });

  it("returns null / no-ops with no window (SSR) or no user", () => {
    vi.stubGlobal("window", undefined);
    expect(readSelectedModel("user-1")).toBeNull();
    expect(() => writeSelectedModel("user-1", "x")).not.toThrow();
    stubStorage();
    expect(readSelectedModel("")).toBeNull();
    writeSelectedModel("", "x");
    expect(readSelectedModel("")).toBeNull();
  });

  it("swallows a throwing setItem (private mode / quota)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceeded");
        },
      },
    });
    expect(() => writeSelectedModel("user-1", "x")).not.toThrow();
  });

  it("swallows a throwing getItem → null (Safari private mode)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {},
      },
    });
    expect(readSelectedModel("user-1")).toBeNull();
  });
});
