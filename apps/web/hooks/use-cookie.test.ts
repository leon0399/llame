// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import Cookies from "js-cookie";

import useCookie from "./use-cookie";

// Real js-cookie against jsdom's document.cookie — no first-party module to
// mock, and js-cookie is the documented external boundary this hook wraps.
// Assertions read document.cookie directly, not just the hook's own echo.
function clearAllCookies() {
  for (const name of Object.keys(Cookies.get())) {
    Cookies.remove(name);
  }
}

afterEach(() => {
  clearAllCookies();
});

describe("useCookie", () => {
  it("reads an existing cookie on mount without a default", () => {
    Cookies.set("theme", "dark");

    const { result } = renderHook(() => useCookie<string>("theme"));

    expect(result.current[0]).toBe("dark");
  });

  it("returns undefined and writes nothing when absent and no default is given", () => {
    const { result } = renderHook(() => useCookie<string>("missing"));

    expect(result.current[0]).toBeUndefined();
    expect(Cookies.get("missing")).toBeUndefined();
  });

  it("seeds the cookie with the default value on first mount when absent", () => {
    const { result } = renderHook(() => useCookie<string>("theme", "light"));

    expect(result.current[0]).toBe("light");
    expect(Cookies.get("theme")).toBe("light");
  });

  it("updates the real cookie and the returned state together", () => {
    const { result } = renderHook(() => useCookie<string>("theme", "light"));

    act(() => {
      result.current[1]("dark");
    });

    expect(result.current[0]).toBe("dark");
    expect(Cookies.get("theme")).toBe("dark");
  });

  it("removes the cookie when updated to undefined", () => {
    const { result } = renderHook(() => useCookie<string>("theme"));

    act(() => {
      result.current[1](undefined);
    });

    expect(result.current[0]).toBeUndefined();
    expect(Cookies.get("theme")).toBeUndefined();
  });

  it("deleteCookie clears both the cookie and the state", () => {
    const { result } = renderHook(() => useCookie<string>("theme", "light"));

    act(() => {
      result.current[2]();
    });

    expect(result.current[0]).toBeUndefined();
    expect(Cookies.get("theme")).toBeUndefined();
  });
});
