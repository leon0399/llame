import { afterEach, describe, expect, it, vi } from "vitest";

const endpoints = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  loginUser: vi.fn(),
  registerUser: vi.fn(),
  logoutUser: vi.fn(),
  revokeSessions: vi.fn(),
}));

const policies = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
  optionalAuthFetch: vi.fn(),
  createAuthenticatedBrowserFetch: vi.fn(),
  createOptionalAuthFetch: vi.fn(),
  handleUnauthorizedResponse: vi.fn(),
}));

const useQuery = vi.hoisted(() => vi.fn());

vi.mock("../../api/generated/auth/auth", () => endpoints);
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch: policies.createAuthenticatedBrowserFetch,
  createOptionalAuthFetch: policies.createOptionalAuthFetch,
  handleUnauthorizedResponse: policies.handleUnauthorizedResponse,
}));
vi.mock("@tanstack/react-query", () => ({ useQuery }));

import {
  authQueryKeys,
  fetchMe,
  fetchMeOptional,
  login,
  logout,
  logoutAllSessions,
  register,
  useMe,
  useMeOptional,
} from "./queries";
import { InvalidCredentialsError, isInvalidCredentialsError } from "./errors";
import type { PublicUserResponse } from "../../api/generated/models";

const authenticatedFetch = policies.authenticatedFetch;
const optionalAuthFetch = policies.optionalAuthFetch;

policies.createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);
policies.createOptionalAuthFetch.mockReturnValue(optionalAuthFetch);

afterEach(() => {
  vi.clearAllMocks();
  policies.createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);
  policies.createOptionalAuthFetch.mockReturnValue(optionalAuthFetch);
});

describe("auth query keys", () => {
  it("keeps the resource-path key", () => {
    expect(authQueryKeys.me).toEqual(["auth", "me"]);
  });
});

describe("auth transport boundaries", () => {
  it("fetches the current user through the authenticated generated endpoint", async () => {
    const user = { id: "u1", name: "A" };
    endpoints.getCurrentUser.mockResolvedValue(user);

    await expect(fetchMe()).resolves.toEqual(user);

    expect(endpoints.getCurrentUser).toHaveBeenCalledWith(
      undefined,
      authenticatedFetch,
    );
    expect(policies.createAuthenticatedBrowserFetch).toHaveBeenCalledWith(
      globalThis.fetch,
    );
  });

  it("submits login credentials through the credential-safe authenticated policy", async () => {
    const result = { user: { id: "u1" } };
    const input = { email: "leo@example.com", password: "secret" };
    endpoints.loginUser.mockResolvedValue(result);

    await expect(login(input)).resolves.toEqual(result);

    expect(endpoints.loginUser).toHaveBeenCalledWith(
      input,
      undefined,
      authenticatedFetch,
    );
  });

  it("submits registration through the credential-safe authenticated policy", async () => {
    const result = { user: { id: "u1" } };
    const input = {
      name: "Leo",
      email: "leo@example.com",
      password: "secret",
    };
    endpoints.registerUser.mockResolvedValue(result);

    await expect(register(input)).resolves.toEqual(result);

    expect(endpoints.registerUser).toHaveBeenCalledWith(
      input,
      undefined,
      authenticatedFetch,
    );
  });

  it("classifies a generated 401 login failure as a service-owned domain error", async () => {
    const generatedError = Object.assign(new Error("Unauthorized"), {
      info: {},
      status: 401,
    });
    endpoints.loginUser.mockRejectedValue(generatedError);

    const error = await login({
      email: "leo@example.com",
      password: "wrong",
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(InvalidCredentialsError);
    expect(isInvalidCredentialsError(error)).toBe(true);
  });

  it("rethrows non-credential login failures unchanged", async () => {
    const generatedError = Object.assign(new Error("Unavailable"), {
      status: 503,
    });
    endpoints.loginUser.mockRejectedValue(generatedError);

    await expect(
      login({ email: "leo@example.com", password: "secret" }),
    ).rejects.toBe(generatedError);
  });

  it("always clears auth state after logging out", async () => {
    endpoints.logoutUser.mockRejectedValue(new Error("network down"));

    await expect(logout()).rejects.toThrow("network down");
    expect(endpoints.logoutUser).toHaveBeenCalledWith(
      undefined,
      authenticatedFetch,
    );
    expect(policies.handleUnauthorizedResponse).toHaveBeenCalledOnce();
  });

  it("revokes all sessions through the generated endpoint and always clears auth state", async () => {
    endpoints.revokeSessions.mockResolvedValue({ revoked: 2 });

    await expect(logoutAllSessions()).resolves.toBeUndefined();
    expect(endpoints.revokeSessions).toHaveBeenCalledWith(
      { scope: "all" },
      undefined,
      authenticatedFetch,
    );
    expect(policies.handleUnauthorizedResponse).toHaveBeenCalledOnce();
  });

  it("uses optional-auth for the nullable current-user probe", async () => {
    const user: PublicUserResponse = {
      id: "u1",
      name: "A",
      email: "leo@example.com",
      emailVerified: null,
      image: null,
    };
    endpoints.getCurrentUser.mockResolvedValue(user);

    await expect(fetchMeOptional()).resolves.toEqual(user);
    expect(endpoints.getCurrentUser).toHaveBeenCalledWith(
      undefined,
      optionalAuthFetch,
    );
    expect(policies.createOptionalAuthFetch).toHaveBeenCalledWith(
      globalThis.fetch,
    );
  });

  it("maps only an optional-auth 401 to null", async () => {
    endpoints.getCurrentUser.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { info: {}, status: 401 }),
    );

    await expect(fetchMeOptional()).resolves.toBeNull();
  });

  it("rethrows unknown optional-auth failures", async () => {
    const generatedError = Object.assign(new Error("Unavailable"), {
      status: 500,
    });
    endpoints.getCurrentUser.mockRejectedValue(generatedError);

    await expect(fetchMeOptional()).rejects.toBe(generatedError);
  });
});

describe("auth query options", () => {
  it("keeps the authenticated me query immediately stale and refetches on mount", () => {
    useMe();

    expect(useQuery).toHaveBeenCalledWith({
      queryKey: authQueryKeys.me,
      queryFn: fetchMe,
      staleTime: 0,
      refetchOnMount: "always",
    });
  });

  it("keeps the optional me query non-retrying", () => {
    useMeOptional();

    expect(useQuery).toHaveBeenCalledWith({
      queryKey: [...authQueryKeys.me, "optional"],
      queryFn: fetchMeOptional,
      staleTime: 0,
      retry: false,
    });
  });
});
