import { useQuery } from "@tanstack/react-query";

import {
  getCurrentUser,
  loginUser,
  logoutUser,
  registerUser,
  revokeSessions,
} from "../../api/generated/auth/auth";
import { getApiErrorStatus } from "../../api/errors";
import {
  createAuthenticatedBrowserFetch,
  createOptionalAuthFetch,
  handleUnauthorizedResponse,
} from "../../api/fetch";
import type {
  AuthTokenResponse,
  PublicUserResponse,
} from "../../api/generated/models";
import { InvalidCredentialsError } from "./errors";

export type { AuthTokenResponse, PublicUserResponse };
export { isInvalidCredentialsError } from "./errors";

export const authQueryKeys = {
  me: ["auth", "me"] as const,
};

function authenticatedFetch(): typeof fetch {
  return createAuthenticatedBrowserFetch(globalThis.fetch);
}

function optionalAuthFetch(): typeof fetch {
  return createOptionalAuthFetch(globalThis.fetch);
}

export async function fetchMe(): Promise<PublicUserResponse> {
  return getCurrentUser(undefined, authenticatedFetch());
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<AuthTokenResponse> {
  try {
    return await loginUser(input, undefined, authenticatedFetch());
  } catch (error) {
    if (getApiErrorStatus(error) === 401) {
      throw new InvalidCredentialsError();
    }
    throw error;
  }
}

export async function register(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthTokenResponse> {
  return registerUser(input, undefined, authenticatedFetch());
}

export async function logout(): Promise<void> {
  // Always clear client auth state + redirect, even if the server revoke fails
  // (network/5xx) — otherwise the UI is stranded thinking it's still signed in.
  try {
    await logoutUser(undefined, authenticatedFetch());
  } finally {
    handleUnauthorizedResponse();
  }
}

export async function logoutAllSessions(): Promise<void> {
  try {
    await revokeSessions({ scope: "all" }, undefined, authenticatedFetch());
  } finally {
    handleUnauthorizedResponse();
  }
}

export function useMe() {
  return useQuery({
    queryKey: authQueryKeys.me,
    queryFn: fetchMe,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

/**
 * Like `fetchMe`, but for a page reachable WITHOUT a session (e.g. the
 * public /shared/[id] view): a 401 here means "not signed in", not "session
 * revoked, redirect to login". Uses the optional-auth policy so the shared
 * browser policy never clears the cache or redirects on this expected result.
 */
export async function fetchMeOptional(): Promise<PublicUserResponse | null> {
  try {
    return await getCurrentUser(undefined, optionalAuthFetch());
  } catch (error) {
    if (getApiErrorStatus(error) === 401) {
      return null;
    }
    throw error;
  }
}

export function useMeOptional() {
  return useQuery({
    queryKey: [...authQueryKeys.me, "optional"],
    queryFn: fetchMeOptional,
    staleTime: 0,
    retry: false,
  });
}
