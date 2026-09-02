import { beforeEach, describe, expect, it, vi } from "vitest";

// next/headers is an external boundary (permitted mock target) — this
// service's cookies() read has no in-process seam otherwise. Everything else
// (option lookup, default fallback) runs for real.
const { cookiesMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(async () => ({
    get: (_name: string): { value: string } | undefined => undefined,
  })),
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));

import {
  getFontStyleFromCookies,
  getMonoFontStyleFromCookies,
  getFontCssVariables,
} from "./service";
import {
  DEFAULT_FONT_STYLE,
  DEFAULT_MONO_FONT_STYLE,
  fontStyleOptions,
  monoFontStyleOptions,
} from "./consts";

function stubCookies(values: Record<string, string>) {
  cookiesMock.mockResolvedValue({
    get: (name: string) =>
      name in values ? { value: values[name] } : undefined,
  });
}

beforeEach(() => {
  stubCookies({});
});

describe("getFontStyleFromCookies", () => {
  it("returns the default when no cookie is set", async () => {
    await expect(getFontStyleFromCookies()).resolves.toBe(DEFAULT_FONT_STYLE);
  });

  it("returns a valid stored font style", async () => {
    stubCookies({ "font-style": "roboto" });
    await expect(getFontStyleFromCookies()).resolves.toBe("roboto");
  });

  it("falls back to the default for an unrecognized stored value", async () => {
    stubCookies({ "font-style": "not-a-real-font" });
    await expect(getFontStyleFromCookies()).resolves.toBe(DEFAULT_FONT_STYLE);
  });
});

describe("getMonoFontStyleFromCookies", () => {
  it("returns the default when no cookie is set", async () => {
    await expect(getMonoFontStyleFromCookies()).resolves.toBe(
      DEFAULT_MONO_FONT_STYLE,
    );
  });

  it("returns a valid stored mono font style", async () => {
    stubCookies({ "mono-font-style": "fira-code" });
    await expect(getMonoFontStyleFromCookies()).resolves.toBe("fira-code");
  });

  it("falls back to the default for an unrecognized stored value", async () => {
    stubCookies({ "mono-font-style": "not-a-real-font" });
    await expect(getMonoFontStyleFromCookies()).resolves.toBe(
      DEFAULT_MONO_FONT_STYLE,
    );
  });
});

describe("getFontCssVariables", () => {
  it("maps the stored font styles to their CSS variables", async () => {
    stubCookies({ "font-style": "roboto", "mono-font-style": "fira-code" });

    await expect(getFontCssVariables()).resolves.toEqual({
      "--font-sans": fontStyleOptions.find((f) => f.value === "roboto")!.cssVar,
      "--font-mono": monoFontStyleOptions.find((f) => f.value === "fira-code")!
        .cssVar,
    });
  });

  it("falls back to the default option's CSS variable when nothing is stored", async () => {
    await expect(getFontCssVariables()).resolves.toEqual({
      "--font-sans": fontStyleOptions.find(
        (f) => f.value === DEFAULT_FONT_STYLE,
      )!.cssVar,
      "--font-mono": monoFontStyleOptions.find(
        (f) => f.value === DEFAULT_MONO_FONT_STYLE,
      )!.cssVar,
    });
  });
});
