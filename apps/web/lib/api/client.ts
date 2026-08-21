import ky from "ky";
import {
  createAuthenticatedBrowserFetch,
  getApiUrl,
  handleAuthenticatedResponse,
} from "./fetch";

export {
  getApiUrl,
  handleUnauthorizedResponse,
  registerApiQueryClient,
} from "./fetch";

export function buildApiUrl(path: string): string {
  const baseUrl = getApiUrl();
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;

  return `${baseUrl}/${normalizedPath}`;
}

export async function authAwareFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return createAuthenticatedBrowserFetch(globalThis.fetch)(input, init);
}

export const api = ky.create({
  credentials: "include",
  hooks: {
    afterResponse: [
      (request, _options, response) => {
        handleAuthenticatedResponse(request.url, response);
      },
    ],
  },
});
