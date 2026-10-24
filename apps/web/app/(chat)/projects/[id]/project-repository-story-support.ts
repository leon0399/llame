import { vi, type Mock } from "vitest";

import type { CheckoutResponse } from "@/lib/services/checkouts/queries";
import type { ProjectRepositoryLink } from "@/lib/services/project/types";
import type { RepositoryResponse } from "@/lib/services/repositories/queries";
import {
  emptyResponse,
  jsonResponse,
  stubFetch,
  type JsonValue,
} from "@/lib/test-support/fetch-stub";

/*
 * Fixtures and a fetch router shared by the repository section and sheet
 * stories. No hook mocking: the real link, catalog, checkout, and chat
 * queries run against a stubbed globalThis.fetch, and every write goes
 * through the same seam. An unrouted request fails the story.
 */

const AT = "2026-10-24T10:00:00.000Z";

export const llame: RepositoryResponse = {
  id: "r1",
  ownerUserId: "u1",
  displayName: "llame",
  canonicalRemote: "github.com/leon0399/llame",
  createdAt: AT,
  updatedAt: AT,
};

export const website: RepositoryResponse = {
  id: "r2",
  ownerUserId: "u1",
  displayName: "website",
  canonicalRemote: "git.example.com/acme/website",
  createdAt: AT,
  updatedAt: AT,
};

export function link(
  overrides: Partial<ProjectRepositoryLink> & { repositoryId: string },
): ProjectRepositoryLink {
  return {
    id: `link-${overrides.repositoryId}`,
    ownerUserId: "u1",
    projectId: "p1",
    alias: "llame",
    isPrimary: false,
    isolation: "inherit",
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

export function checkout(
  overrides: Partial<CheckoutResponse> & { id: string; path: string },
): CheckoutResponse {
  return {
    repositoryId: "r1",
    executorId: "personal-host-a",
    kind: "main",
    parentCheckoutId: null,
    branch: "master",
    origin: "registered",
    worktreeBase: null,
    chatIds: [],
    leaseChatId: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

export const localClone = checkout({
  id: "c1",
  path: "/home/leo/src/llame",
});

export const machineClone = checkout({
  id: "c4",
  executorId: "machine:devbox",
  path: "machine://devbox/home/box/work/llame",
});

export const clearFieldWorktree = checkout({
  id: "c2",
  kind: "worktree",
  parentCheckoutId: "c1",
  path: "/home/leo/src/.llame-worktrees/llame/clear-field-0192",
  branch: "llame/clear-field-0192",
  origin: "created",
  chatIds: ["chat-1", "chat-2"],
  leaseChatId: "chat-1",
});

const CHATS: ReadonlyArray<{ id: string; title: string }> = [
  { id: "chat-1", title: "Clear field" },
  { id: "chat-2", title: "Retry policy" },
];

/** What the stubbed API answers; each story's `beforeEach` sets it. */
type StoryApi = {
  links: Array<ProjectRepositoryLink>;
  repositories: Array<RepositoryResponse>;
  checkouts: Array<CheckoutResponse>;
  /** The answer to a worktree removal or an unlink; null answers 204. */
  refusal: { status: number; body: object } | null;
  /** The checkout a registration answers with. */
  registered: CheckoutResponse;
};

export const api: StoryApi = {
  links: [],
  repositories: [],
  checkouts: [],
  refusal: null,
  registered: localClone,
};

/** "METHOD /path?query" a fetch call targets. */
function routeOf(input: RequestInfo | URL) {
  const request = input instanceof Request ? input : new Request(input);
  const url = new URL(request.url);
  return `${request.method} ${url.pathname}${url.search}`;
}

function chatResponse(chatId: string) {
  const chat = CHATS.find((candidate) => candidate.id === chatId);
  if (chat === undefined) throw new Error(`unknown chat in story: ${chatId}`);
  return jsonResponse({
    id: chat.id,
    ownerUserId: "u1",
    title: chat.title,
    visibility: "private",
    createdAt: AT,
    updatedAt: AT,
    archivedAt: null,
    projectId: "p1",
    workspaceRoot: null,
  });
}

function refusalOrEmpty() {
  return api.refusal === null
    ? emptyResponse()
    : jsonResponse(api.refusal.body, api.refusal.status);
}

const LINKS = "/api/v1/projects/p1/repositories";

function answer(key: string): Response {
  if (key === `GET ${LINKS}`) return jsonResponse(api.links);
  if (key === "GET /api/v1/repositories") return jsonResponse(api.repositories);
  if (key === "GET /api/v1/checkouts") return jsonResponse(api.checkouts);
  if (key === `POST ${LINKS}`)
    return jsonResponse(link({ repositoryId: "r2" }), 201);
  if (key.startsWith(`PATCH ${LINKS}/`))
    return jsonResponse(link({ repositoryId: "r1" }));
  if (key.startsWith(`DELETE ${LINKS}/`)) return refusalOrEmpty();
  if (key === "POST /api/v1/checkouts")
    return jsonResponse(api.registered, 201);
  if (key.startsWith("DELETE /api/v1/checkouts/")) return refusalOrEmpty();
  if (key.startsWith("GET /api/v1/chats/")) {
    return chatResponse(key.slice("GET /api/v1/chats/".length));
  }
  throw new Error(`unrouted fetch in story: ${key}`);
}

let fetchMock: Mock<typeof fetch>;

/** Stubs fetch with the router above; returns the cleanup a `beforeEach`
 *  hands back. */
export function routeFetch() {
  fetchMock = stubFetch();
  fetchMock.mockImplementation((input) =>
    Promise.resolve(answer(routeOf(input))),
  );
  return () => {
    vi.unstubAllGlobals();
  };
}

/** "METHOD /path?query" of every request sent so far, in order. */
export function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => routeOf(input));
}

/** The JSON body of the first request sent to `route`. */
export async function sentBody(route: string): Promise<JsonValue> {
  const call = fetchMock.mock.calls.find(([input]) => routeOf(input) === route);
  if (call === undefined) throw new Error(`no request to ${route}`);
  const [input, init] = call;
  const request = input instanceof Request ? input : new Request(input, init);
  return request.clone().json();
}
