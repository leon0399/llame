import { afterEach, describe, expect, it, vi } from "vitest";

import Page from "./page";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(() => {
    throw new Error("redirected");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

describe("new chat page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    redirectMock.mockClear();
  });

  it("redirects to a canonical fresh draft before mounting chat UI", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "a5dc235e-1de8-4aad-84d8-e0e247b6a135",
    );

    expect(() => Page()).toThrow("redirected");
    expect(redirectMock).toHaveBeenCalledWith(
      "/chat/a5dc235e-1de8-4aad-84d8-e0e247b6a135?draft=fresh",
    );
  });
});
