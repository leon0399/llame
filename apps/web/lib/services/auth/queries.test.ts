import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { QueryClient } from "@tanstack/react-query";

import {
  authQueryKeys,
  fetchMe,
  fetchMeOptional,
  login,
  logout,
  logoutAllSessions,
  register,
} from "./queries";
import { InvalidCredentialsError, isInvalidCredentialsError } from "./errors";
import { registerApiQueryClient } from "../../api/fetch";
import type { PublicUserResponse } from "../../api/generated/models";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";

// No @vitest-environment jsdom here: `window` stays undefined, so
// handleUnauthorizedResponse()'s redirect branch (tested via renderHook, in
// jsdom, in queries.hooks.test.ts) short-circuits after clearing the query
// cache -- exactly the boundary these transport tests care about.
let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth query keys", () => {
  it("keeps the resource-path key", () => {
    expect(authQueryKeys.me).toEqual(["auth", "me"]);
  });
});

describe("auth transport boundaries", () => {
  it("fetches the current user through the authenticated, credentialed policy", async () => {
    const user = { id: "u1", name: "A" };
    fetchMock.mockResolvedValue(jsonResponse(user));

    await expect(fetchMe()).resolves.toEqual(user);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/auth/v1/me");
    expect(request.credentials).toBe("include");
  });

  it("submits login credentials through the credential-safe authenticated policy", async () => {
    const result = { user: { id: "u1" } };
    const input = { email: "leo@example.com", password: "secret" };
    fetchMock.mockResolvedValue(jsonResponse(result));

    await expect(login(input)).resolves.toEqual(result);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/auth/v1/login");
    await expect(request.clone().json()).resolves.toEqual(input);
  });

  it("submits registration through the credential-safe authenticated policy", async () => {
    const result = { user: { id: "u1" } };
    const input = {
      name: "Leo",
      email: "leo@example.com",
      password: "secret",
    };
    fetchMock.mockResolvedValue(jsonResponse(result));

    await expect(register(input)).resolves.toEqual(result);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/auth/v1/register");
    await expect(request.clone().json()).resolves.toEqual(input);
  });

  it("classifies a generated 401 login failure as a service-owned domain error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401));

    const error = await login({
      email: "leo@example.com",
      password: "wrong",
    }).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(InvalidCredentialsError);
    expect(isInvalidCredentialsError(error)).toBe(true);
  });

  it("rethrows non-credential login failures unchanged", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "down" }, 503));

    await expect(
      login({ email: "leo@example.com", password: "secret" }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("always clears cached auth state after logging out, even when the revoke fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const queryClient = new QueryClient();
    registerApiQueryClient(queryClient);
    const clearSpy = vi.spyOn(queryClient, "clear");

    await expect(logout()).rejects.toThrow("network down");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).pathname).toBe("/auth/v1/sessions/current");
    expect(clearSpy).toHaveBeenCalledOnce();
  });

  it("revokes all sessions through the generated endpoint and always clears cached auth state", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ revoked: 2 }));
    const queryClient = new QueryClient();
    registerApiQueryClient(queryClient);
    const clearSpy = vi.spyOn(queryClient, "clear");

    await expect(logoutAllSessions()).resolves.toBeUndefined();

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).pathname).toBe("/auth/v1/sessions");
    expect(new URL(request.url).searchParams.get("scope")).toBe("all");
    expect(clearSpy).toHaveBeenCalledOnce();
  });

  it("uses optional-auth for the nullable current-user probe", async () => {
    const user: PublicUserResponse = {
      id: "u1",
      name: "A",
      email: "leo@example.com",
      emailVerified: null,
      image: null,
    };
    fetchMock.mockResolvedValue(jsonResponse(user));

    await expect(fetchMeOptional()).resolves.toEqual(user);
    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/auth/v1/me");
    expect(request.credentials).toBe("include");
  });

  it("maps only an optional-auth 401 to null", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401));
    await expect(fetchMeOptional()).resolves.toBeNull();
  });

  it("rethrows unknown optional-auth failures", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "down" }, 500));
    await expect(fetchMeOptional()).rejects.toMatchObject({ status: 500 });
  });
});
