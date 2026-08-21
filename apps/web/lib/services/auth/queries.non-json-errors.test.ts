import { afterEach, describe, expect, it, vi } from "vitest";

const policies = vi.hoisted(() => ({
  authenticatedFetch: vi.fn<typeof fetch>(),
  optionalAuthFetch: vi.fn<typeof fetch>(),
  createAuthenticatedBrowserFetch: vi.fn(),
  createOptionalAuthFetch: vi.fn(),
}));

vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch: policies.createAuthenticatedBrowserFetch,
  createOptionalAuthFetch: policies.createOptionalAuthFetch,
  handleUnauthorizedResponse: vi.fn(),
}));

import { InvalidCredentialsError } from "./errors";
import { fetchMeOptional, login } from "./queries";

policies.createAuthenticatedBrowserFetch.mockReturnValue(
  policies.authenticatedFetch,
);
policies.createOptionalAuthFetch.mockReturnValue(policies.optionalAuthFetch);

afterEach(() => {
  vi.clearAllMocks();
  policies.createAuthenticatedBrowserFetch.mockReturnValue(
    policies.authenticatedFetch,
  );
  policies.createOptionalAuthFetch.mockReturnValue(policies.optionalAuthFetch);
});

describe("auth service non-JSON error outcomes", () => {
  it("classifies a non-JSON generated 401 login failure", async () => {
    const rawBody = "<html><body>unauthorized</body></html>";
    policies.authenticatedFetch.mockResolvedValue(
      new Response(rawBody, { status: 401 }),
    );

    await expect(
      login({ email: "leo@example.com", password: "wrong" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("maps a non-JSON generated 401 optional-auth failure to null", async () => {
    const rawBody = "<html><body>unauthorized</body></html>";
    policies.optionalAuthFetch.mockResolvedValue(
      new Response(rawBody, { status: 401 }),
    );

    await expect(fetchMeOptional()).resolves.toBeNull();
  });
});
