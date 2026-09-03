import { afterEach, describe, expect, it, vi } from "vitest";

import { safeRandomUUID } from "./uuid";

const originalCrypto = globalThis.crypto;

afterEach(() => {
  vi.stubGlobal("crypto", originalCrypto);
  vi.unstubAllGlobals();
});

describe("safeRandomUUID", () => {
  it("delegates to crypto.randomUUID when available", () => {
    const randomUUID = vi.fn(() => "11111111-1111-4111-8111-111111111111");
    vi.stubGlobal("crypto", { randomUUID });

    expect(safeRandomUUID()).toBe("11111111-1111-4111-8111-111111111111");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("falls back to crypto.getRandomValues, stamping version 4 and RFC 4122 variant bits", () => {
    // All-zero bytes isolate the masking under test: with input 0x00, the
    // version nibble (`& 0x0f | 0x40`) and variant bits (`& 0x3f | 0x80`)
    // are pinned to exactly "4" and "8", not merely one of several valid
    // values — a stronger check than the general-shape regex alone.
    const getRandomValues = vi.fn((array: Uint8Array) => {
      array.fill(0x00);
      return array;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    const id = safeRandomUUID();
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const [, , third, fourth] = id.split("-");
    expect(third![0]).toBe("4");
    expect(fourth![0]).toBe("8");
  });

  it("falls back to Math.random when crypto is entirely absent", () => {
    vi.stubGlobal("crypto", undefined);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);

    const id = safeRandomUUID();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(randomSpy).toHaveBeenCalled();
    randomSpy.mockRestore();
  });
});
