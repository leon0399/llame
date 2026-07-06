import { useQuery } from "@tanstack/react-query";
import { api, buildApiUrl, handleUnauthorizedResponse } from "../../api/client";

export type PublicUserResponse = {
  id: string;
  name: string | null;
  email: string | null;
  emailVerified: string | null;
  image: string | null;
};

export type AuthTokenResponse = {
  token: string;
  user: PublicUserResponse;
  session: {
    id: string;
    userAgent: string | null;
    ip: string | null;
    createdAt: string;
    lastSeenAt: string;
    expires: string;
    current: boolean;
  };
};

export const authQueryKeys = {
  me: ["auth", "me"] as const,
};

export async function fetchMe(): Promise<PublicUserResponse> {
  return api.get(buildApiUrl("/auth/v1/me")).json<PublicUserResponse>();
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<AuthTokenResponse> {
  return api
    .post(buildApiUrl("/auth/v1/login"), { json: input })
    .json<AuthTokenResponse>();
}

export async function register(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthTokenResponse> {
  return api
    .post(buildApiUrl("/auth/v1/register"), { json: input })
    .json<AuthTokenResponse>();
}

export async function logout(): Promise<void> {
  // Always clear client auth state + redirect, even if the server revoke fails
  // (network/5xx) — otherwise the UI is stranded thinking it's still signed in.
  try {
    await api.delete(buildApiUrl("/auth/v1/sessions/current")).json();
  } finally {
    handleUnauthorizedResponse();
  }
}

export async function logoutAllSessions(): Promise<void> {
  try {
    await api
      .delete(buildApiUrl("/auth/v1/sessions"), {
        searchParams: { scope: "all" },
      })
      .json();
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
 * revoked, redirect to login". Uses a plain `fetch`, not the shared `api` ky
 * client — that client's `afterResponse` hook globally redirects to /login on
 * ANY 401 (correct for the authenticated app shell, wrong here: an anonymous
 * visitor viewing a public share must never be bounced to /login just for
 * checking whether a "fork to continue" button should render).
 */
export async function fetchMeOptional(): Promise<PublicUserResponse | null> {
  const response = await fetch(buildApiUrl("/auth/v1/me"), {
    credentials: "include",
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to check auth state: ${response.status}`);
  }
  return response.json() as Promise<PublicUserResponse>;
}

export function useMeOptional() {
  return useQuery({
    queryKey: [...authQueryKeys.me, "optional"],
    queryFn: fetchMeOptional,
    staleTime: 0,
    retry: false,
  });
}
