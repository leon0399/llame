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
  window.location.assign('/login');
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

export const api = ky.create({
  credentials: 'include',
  hooks: {
    afterResponse: [
      (_request, _options, response) => {
        if (response.status === 401) {
          handleUnauthorizedResponse();
        }
      },
    ],
  },
});
