// @vitest-environment jsdom

/**
 * Integration-level proof for the real AppearanceProvider: useTheme (next-
 * themes) needs no mock here — without an ancestor ThemeProvider it resolves
 * to its own documented default ({ setTheme: noop }, no `theme` key), which
 * is exactly the "system" fallback this provider already handles. useCookie
 * runs for real against jsdom's document.cookie (see hooks/use-cookie.test.ts).
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import Cookies from "js-cookie";

import { AppearanceProvider, useAppearance } from "./appearance-context";
import {
  DEFAULT_FONT_STYLE,
  DEFAULT_MONO_FONT_STYLE,
  fontStyleOptions,
} from "@/lib/appearance/font/consts";

function Consumer() {
  const {
    theme,
    fontSize,
    fontStyle,
    monoFontStyle,
    setFontSize,
    setFontStyle,
  } = useAppearance();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="font-size">{fontSize}</span>
      <span data-testid="font-style">{fontStyle}</span>
      <span data-testid="mono-font-style">{monoFontStyle}</span>
      <button type="button" onClick={() => setFontSize("large")}>
        grow
      </button>
      <button type="button" onClick={() => setFontStyle("roboto")}>
        roboto
      </button>
    </div>
  );
}

function clearAllCookies() {
  for (const name of Object.keys(Cookies.get())) {
    Cookies.remove(name);
  }
}

afterEach(() => {
  clearAllCookies();
  cleanup();
});

describe("AppearanceProvider", () => {
  it("defaults theme to 'system' and font style/size to the configured defaults", () => {
    render(
      <AppearanceProvider>
        <Consumer />
      </AppearanceProvider>,
    );

    expect(screen.getByTestId("theme").textContent).toBe("system");
    expect(screen.getByTestId("font-size").textContent).toBe("medium");
    expect(screen.getByTestId("font-style").textContent).toBe(
      DEFAULT_FONT_STYLE,
    );
    expect(screen.getByTestId("mono-font-style").textContent).toBe(
      DEFAULT_MONO_FONT_STYLE,
    );
  });

  it("setFontSize updates the context value", () => {
    render(
      <AppearanceProvider>
        <Consumer />
      </AppearanceProvider>,
    );

    act(() => screen.getByText("grow").click());

    expect(screen.getByTestId("font-size").textContent).toBe("large");
  });

  it("setFontStyle persists the cookie and applies the CSS variable to the document", () => {
    render(
      <AppearanceProvider>
        <Consumer />
      </AppearanceProvider>,
    );

    act(() => screen.getByText("roboto").click());

    expect(screen.getByTestId("font-style").textContent).toBe("roboto");
    expect(Cookies.get("font-style")).toBe("roboto");
    const robotoVar = fontStyleOptions.find(
      (f) => f.value === "roboto",
    )!.cssVar;
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe(
      robotoVar,
    );
  });
});
