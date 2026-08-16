import { afterEach, describe, expect, it, vi } from "vitest";

import Page from "./page";

const { connectionMock, redirectMock } = vi.hoisted(() => ({
  connectionMock: vi.fn().mockResolvedValue(undefined),
  redirectMock: vi.fn(() => {
    throw new Error("redirected");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/server", () => ({ connection: connectionMock }));

describe("new chat page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    connectionMock.mockClear();
    redirectMock.mockClear();
  });

  it("waits for a request before minting and redirecting to a fresh draft", async () => {
    let releaseConnection: () => void = () => undefined;
    connectionMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseConnection = resolve;
        }),
    );
    const randomUUID = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("a5dc235e-1de8-4aad-84d8-e0e247b6a135");

    const result = Page();

    expect(connectionMock).toHaveBeenCalledOnce();
    expect(randomUUID).not.toHaveBeenCalled();

    releaseConnection();
    await expect(result).rejects.toThrow("redirected");
    expect(redirectMock).toHaveBeenCalledWith(
      "/chat/a5dc235e-1de8-4aad-84d8-e0e247b6a135?draft=fresh",
    );
  });
});
