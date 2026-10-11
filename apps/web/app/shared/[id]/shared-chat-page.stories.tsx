import { Suspense } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import type { PublicUserResponse } from "@/lib/services/auth/queries";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";
import SharedChatPage from "./page";

// No hook mocking: the page's paginated shared-chat walk, useMeOptional and
// useForkSharedChat run for real against a stubbed globalThis.fetch. The
// shared chat and the fork can be held until a story releases them, so a
// story can observe the page while they are in flight. An unrouted request
// fails the story.
const SHARED_CHAT_ROUTE = "GET /api/v1/shared/chats/chat-1?limit=100";
const ME_ROUTE = "GET /auth/v1/me";
const FORK_ROUTE = "POST /api/v1/shared/chats/chat-1/forks";

const ME: PublicUserResponse = {
  id: "u1",
  name: "Leo",
  email: "leo@example.com",
  emailVerified: null,
  image: null,
};

// The App Router hands a client page its params as a promise; one settled
// promise for every render, so `use(params)` suspends only once.
const PARAMS = Promise.resolve({ id: "chat-1" });

// The fork opens the new chat through the router. nextjs-vite provides
// `useRouter()` from the story's `nextjs.router` parameter.
const routerPush = fn().mockName("router.push");

let fetchMock: Mock<typeof fetch>;
let sharedChat: () => Response;
let me: () => Response;
let holdSharedChat: boolean;
let holdFork: boolean;
let releaseSharedChat: () => void;
let releaseFork: () => void;

function sharedChatBody(title: string | null) {
  return {
    id: "chat-1",
    title,
    messages: [
      {
        id: "m1",
        seq: 1,
        role: "user",
        parts: [{ type: "text", text: "Hello there" }],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "m2",
        seq: 2,
        role: "assistant",
        parts: [{ type: "text", text: "General Kenobi" }],
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    ],
  };
}

/** "METHOD /path?query" a fetch call targets. */
function routeOf(input: RequestInfo | URL) {
  const request = input instanceof Request ? input : new Request(input);
  const url = new URL(request.url);
  return `${request.method} ${url.pathname}${url.search}`;
}

/** "METHOD /path?query" of every request sent so far, in order. */
function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => routeOf(input));
}

/** A response now, or — while a story holds it — once released. */
function answer(
  respond: () => Response,
  hold: boolean,
  onHold: (release: () => void) => void,
) {
  if (!hold) return Promise.resolve(respond());
  return new Promise<Response>((resolve) => {
    onHold(() => resolve(respond()));
  });
}

function routeFetch() {
  fetchMock = stubFetch();
  fetchMock.mockImplementation((input) => {
    const key = routeOf(input);
    if (key === SHARED_CHAT_ROUTE) {
      return answer(
        sharedChat,
        holdSharedChat,
        (release) => (releaseSharedChat = release),
      );
    }
    if (key === ME_ROUTE) return Promise.resolve(me());
    if (key === FORK_ROUTE) {
      return answer(
        () => jsonResponse({ id: "forked-1" }),
        holdFork,
        (release) => (releaseFork = release),
      );
    }
    throw new Error(`unrouted fetch in story: ${key}`);
  });
}

const meta = {
  component: SharedChatPage,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/shared/chat-1" },
      router: { push: routerPush },
    },
  },
  beforeEach: () => {
    sharedChat = () => jsonResponse(sharedChatBody("A shared chat"));
    // Signed out: the optional session check answers 401.
    me = () => new Response(null, { status: 401 });
    holdSharedChat = false;
    holdFork = false;
    routerPush.mockClear();
    routeFetch();
    return () => {
      vi.unstubAllGlobals();
    };
  },
  // The App Router wraps a client page in a Suspense boundary; `use(params)`
  // suspends on the first render even for a settled promise. `params` stays
  // off `args`: Storybook's args serializer warns about a cycle in a Promise.
  render: () => (
    <Suspense fallback={null}>
      <SharedChatPage params={PARAMS} />
    </Suspense>
  ),
} satisfies Meta<typeof SharedChatPage>;

export default meta;
// The meta's render supplies `params`, so no story sets args.
type Story = StoryObj<typeof SharedChatPage>;

/**
 * A signed-out visitor reads the shared conversation under its title, marked
 * read-only, and is offered a login that returns them to this share rather
 * than a fork.
 *
 * @summary signed out: the conversation and a login link back to it
 */
export const SignedOut: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const login = await canvas.findByRole("link", {
      name: "Log in to continue",
    });
    await expect(login).toBeVisible();
    await expect(login).toHaveAttribute(
      "href",
      "/login?callbackUrl=%2Fshared%2Fchat-1",
    );
    await expect(
      canvas.getByRole("heading", { level: 1, name: "A shared chat" }),
    ).toBeVisible();
    await expect(
      canvas.getByText("Shared conversation · read-only"),
    ).toBeVisible();
    await expect(canvas.getByText("Hello there")).toBeVisible();
    await expect(canvas.getByText("General Kenobi")).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: /Fork/ }),
    ).not.toBeInTheDocument();
    await expect(sentRoutes()).toEqual([SHARED_CHAT_ROUTE, ME_ROUTE]);
  },
};

/**
 * While the shared chat is still loading, the page says so; once it lands,
 * the conversation replaces the note.
 *
 * @summary loading: a note until the shared chat lands
 */
export const Loading: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    holdSharedChat = true;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByText("Loading…")).toBeVisible();
    await waitFor(() =>
      expect(sentRoutes()).toEqual([SHARED_CHAT_ROUTE, ME_ROUTE]),
    );
    await expect(canvas.queryByRole("heading")).not.toBeInTheDocument();

    releaseSharedChat();

    await expect(
      await canvas.findByRole("heading", { level: 1, name: "A shared chat" }),
    ).toBeVisible();
    await expect(canvas.getByText("Hello there")).toBeVisible();
    await expect(canvas.queryByText("Loading…")).not.toBeInTheDocument();
  },
};

/**
 * A chat whose title is still being generated is headed "Untitled chat".
 *
 * @summary untitled: the placeholder heading
 */
export const Untitled: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    sharedChat = () => jsonResponse(sharedChatBody(null));
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Untitled chat" }),
    ).toBeVisible();
    await expect(canvas.getByText("Hello there")).toBeVisible();
  },
};

/**
 * A share link that no longer resolves says the chat isn't available, with a
 * note on why, and shows no conversation.
 *
 * @summary unavailable: the shared chat could not be loaded
 */
export const Unavailable: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    sharedChat = () => new Response(null, { status: 404 });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByRole("heading", {
        level: 1,
        name: "This chat isn’t available",
      }),
    ).toBeVisible();
    await expect(
      canvas.getByText(
        "The link may be wrong, or the chat is no longer shared.",
      ),
    ).toBeVisible();
    await expect(canvas.queryByText("Hello there")).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("link", { name: "Log in to continue" }),
    ).not.toBeInTheDocument();
  },
};

/**
 * A signed-in visitor can fork the shared chat into their own account: the
 * button reads "Forking…" and is disabled while the fork is in flight, then
 * the page opens the new chat.
 *
 * @summary signed in: Fork to continue opens the new copy
 */
export const SignedInFork: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    me = () => jsonResponse(ME);
    holdFork = true;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const fork = await canvas.findByRole("button", {
      name: "Fork to continue",
    });
    await expect(
      canvas.queryByRole("link", { name: "Log in to continue" }),
    ).not.toBeInTheDocument();
    await expect(sentRoutes()).toEqual([SHARED_CHAT_ROUTE, ME_ROUTE]);

    await userEvent.click(fork);

    const forking = await canvas.findByRole("button", { name: "Forking…" });
    await expect(forking).toBeDisabled();
    await waitFor(() =>
      expect(sentRoutes()).toEqual([SHARED_CHAT_ROUTE, ME_ROUTE, FORK_ROUTE]),
    );
    await expect(routerPush).not.toHaveBeenCalled();

    releaseFork();

    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith("/chat/forked-1"),
    );
    await expect(routerPush).toHaveBeenCalledTimes(1);
    await expect(sentRoutes()).toEqual([
      SHARED_CHAT_ROUTE,
      ME_ROUTE,
      FORK_ROUTE,
    ]);
  },
};
