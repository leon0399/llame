import type { QueryClient } from "@tanstack/react-query";

const DEFAULT_DEV_API_URL = "http://localhost:3001";
const CREDENTIAL_SUBMISSION_PATHS = ["/auth/v1/login", "/auth/v1/register"];

let queryClient: QueryClient | undefined;
let redirectingToLogin = false;

export function registerApiQueryClient(client: QueryClient): void {
  queryClient = client;
}

export function getApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  const apiUrl =
    configured ||
    (process.env.NODE_ENV !== "production" ? DEFAULT_DEV_API_URL : undefined);

  if (!apiUrl) {
    throw new Error("NEXT_PUBLIC_API_URL is required");
  }

  return apiUrl.replace(/\/+$/, "");
}

/** Resolve an API-relative path for the explicit AI SDK streaming transports. */
export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${getApiUrl()}/${normalizedPath}`;
}

function resolveApiUrl(input: RequestInfo | URL): string {
  const value = input instanceof Request ? input.url : input.toString();

  try {
    return new URL(value).toString();
  } catch {
    return new URL(value, `${getApiUrl()}/`).toString();
  }
}

function createResolvedRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  credentials: RequestCredentials | undefined,
): Request {
  const requestInput = input instanceof Request ? input : resolveApiUrl(input);
  const requestInit =
    credentials === undefined ? init : { ...init, credentials };

  return new Request(requestInput, requestInit);
}

function isCredentialSubmission(requestUrl: string): boolean {
  try {
    const { pathname } = new URL(requestUrl);
    return CREDENTIAL_SUBMISSION_PATHS.some((path) => pathname.endsWith(path));
  } catch {
    return false;
  }
}

export function handleUnauthorizedResponse(): void {
  queryClient?.clear();

  // `globalThis.window` is a property read (safe even when absent), unlike
  // the bare `window` identifier — reading that directly during SSR (where
  // it was never declared) throws a ReferenceError instead of evaluating to
  // `undefined`.
  if (globalThis.window === undefined || redirectingToLogin) {
    return;
  }

  redirectingToLogin = true;
  const { pathname, search } = window.location;
  const onAuthPage = pathname === "/login" || pathname === "/register";
  const target = onAuthPage
    ? "/login"
    : `/login?callbackUrl=${encodeURIComponent(`${pathname}${search}`)}`;
  window.location.assign(target);
}

export function handleAuthenticatedResponse(
  requestUrl: string,
  response: Response,
): void {
  if (response.status === 401 && !isCredentialSubmission(requestUrl)) {
    handleUnauthorizedResponse();
  }
}

export function createAuthenticatedBrowserFetch(
  fetchImpl: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    const request = createResolvedRequest(input, init, "include");
    const response = await fetchImpl(request);
    handleAuthenticatedResponse(request.url, response);
    return response;
  };
}

/** Fetch entrypoint retained for the explicit AI SDK streaming transports. */
export function authAwareFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return createAuthenticatedBrowserFetch(globalThis.fetch)(input, init);
}

export function createOptionalAuthFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const request = createResolvedRequest(input, init, "include");
    return fetchImpl(request);
  };
}

export function createServerFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const request = createResolvedRequest(input, init, undefined);
    return fetchImpl(request);
  };
}
