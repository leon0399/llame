import type { QueryClient } from '@tanstack/react-query';
import ky from 'ky';

const DEFAULT_DEV_API_URL = 'http://localhost:3001';

let queryClient: QueryClient | undefined;
let redirectingToLogin = false;

export function registerApiQueryClient(client: QueryClient): void {
  queryClient = client;
}

export function buildApiUrl(path: string): string {
  const baseUrl = getApiUrl();
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;

  return `${baseUrl}/${normalizedPath}`;
}

export function getApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  const apiUrl =
    configured ||
    (process.env.NODE_ENV !== 'production' ? DEFAULT_DEV_API_URL : undefined);

  if (!apiUrl) {
    throw new Error('NEXT_PUBLIC_API_URL is required');
  }

  return apiUrl.replace(/\/+$/, '');
}

export function handleUnauthorizedResponse(): void {
  queryClient?.clear();

  if (typeof window === 'undefined' || redirectingToLogin) {
    return;
  }

  redirectingToLogin = true;
  // Carry the current location so re-auth returns the user to where they were.
  // Skip it on auth pages to avoid /login?callbackUrl=/login.
  const { pathname, search } = window.location;
  const onAuthPage = pathname === '/login' || pathname === '/register';
  const target = onAuthPage
    ? '/login'
    : `/login?callbackUrl=${encodeURIComponent(`${pathname}${search}`)}`;
  window.location.assign(target);
}

export async function authAwareFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    credentials: init?.credentials ?? 'include',
  });

  if (response.status === 401) {
    handleUnauthorizedResponse();
  }

  return response;
}

// A 401 from a credential-submission endpoint means "bad credentials", not
// "session revoked" — it must NOT trigger the global cache-clear + redirect
// (that would reload the login page before the form can show the error).
const CREDENTIAL_SUBMISSION_PATHS = ['/auth/v1/login', '/auth/v1/register'];

function isCredentialSubmission(requestUrl: string): boolean {
  try {
    const { pathname } = new URL(requestUrl);
    return CREDENTIAL_SUBMISSION_PATHS.some((path) => pathname.endsWith(path));
  } catch {
    return false;
  }
}

export const api = ky.create({
  credentials: 'include',
  hooks: {
    afterResponse: [
      (request, _options, response) => {
        if (response.status === 401 && !isCredentialSubmission(request.url)) {
          handleUnauthorizedResponse();
        }
      },
    ],
  },
});
