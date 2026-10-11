import { useEffect, useState } from "react";

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import { useMe } from "@/lib/services/auth/queries";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";
import { LoginForm } from "./login-form";

// No hook mocking: the real login() and useMe() run against a stubbed
// globalThis.fetch, so "Invalid email or password" proves the real 401 ->
// InvalidCredentialsError mapping. The login POST is held until a story
// answers it, so the pending state is observable; the destination's session
// refetch is never answered, so whatever user it shows came from the cache
// the form seeded. An unrouted request fails the story.
const LOGIN_ROUTE = "POST /auth/v1/login";
const ME_ROUTE = "GET /auth/v1/me";

const account = {
  id: "u1",
  name: "Leo",
  email: "leo@example.com",
  emailVerified: null,
  image: null,
};

let fetchMock: Mock<typeof fetch>;
let answerLogin: (response: Response) => void;

/** The "METHOD /path" a fetch call targets. */
function routeOf(input: RequestInfo | URL) {
  const request = input instanceof Request ? input : new Request(input);
  return `${request.method} ${new URL(request.url).pathname}`;
}

/** Every request the story sent, in order, as "METHOD /path". */
function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => routeOf(input));
}

function routeFetch() {
  fetchMock = stubFetch();
  fetchMock.mockImplementation((input) => {
    const key = routeOf(input);
    if (key === LOGIN_ROUTE) {
      return new Promise<Response>((resolve) => {
        answerLogin = resolve;
      });
    }
    if (key === ME_ROUTE) return new Promise<Response>(() => {});
    throw new Error(`unrouted fetch in story: ${key}`);
  });
}

// The form navigates through the router. nextjs-vite calls the story's
// `nextjs.router.push` parameter, so this spy both records the destination and
// opens it in place of the form, the way the App Router would.
let navigate: ((href: string) => void) | undefined;
const routerPush = fn((href: string) => navigate?.(href)).mockName(
  "router.push",
);

/** Stands in for the page the form navigates to: it reads the session the
 *  way the app shell does, through the real useMe(). */
function Destination({ href }: { href: string }) {
  const { data: user } = useMe();
  return (
    <div>
      <p>Opened {href}</p>
      <p>{user ? `Signed in as ${user.name}` : "Loading session"}</p>
    </div>
  );
}

/** The login page until the form navigates, then the destination. */
function LoginThenDestination() {
  const [href, setHref] = useState<string>();
  useEffect(() => {
    navigate = setHref;
    return () => {
      navigate = undefined;
    };
  }, []);
  return href === undefined ? <LoginForm /> : <Destination href={href} />;
}

type LoginParameters = { search?: string };

const meta = {
  component: LoginForm,
  tags: ["autodocs"],
  parameters: { nextjs: { router: { push: routerPush } } },
  // The form reads ?callbackUrl= from the page URL, so each story opens on
  // /login with its own query and leaves the URL as it was.
  beforeEach: ({ parameters }) => {
    const { search = "" }: LoginParameters = parameters;
    const href = window.location.href;
    window.history.replaceState(window.history.state, "", `/login${search}`);
    routerPush.mockClear();
    routeFetch();
    return () => {
      vi.unstubAllGlobals();
      window.history.replaceState(window.history.state, "", href);
    };
  },
  render: () => <LoginThenDestination />,
} satisfies Meta<typeof LoginForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Types the credentials and presses Sign In. */
async function signIn(canvasElement: HTMLElement, password: string) {
  const canvas = within(canvasElement);
  await userEvent.type(canvas.getByLabelText("Email"), "leo@example.com");
  await userEvent.type(canvas.getByLabelText("Password"), password);
  await userEvent.click(canvas.getByRole("button", { name: "Sign In" }));
  await waitFor(() => expect(sentRoutes()).toEqual([LOGIN_ROUTE]));
}

/**
 * Signing in sends the typed credentials, shows Signing in... until the server
 * answers, then opens the home page already signed in as the returned user,
 * before the home page's own session request comes back.
 *
 * @summary sign in: pending, then home as the returned user
 */
export const SignIn: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await signIn(canvasElement, "hunter2");

    await expect(
      canvas.getByRole("button", { name: "Signing in..." }),
    ).toBeDisabled();
    await expect(requestFromCall(fetchMock).clone().json()).resolves.toEqual({
      email: "leo@example.com",
      password: "hunter2",
    });

    answerLogin(jsonResponse({ user: account }));

    await expect(await canvas.findByText("Opened /")).toBeVisible();
    await expect(canvas.getByText("Signed in as Leo")).toBeVisible();
    await expect(routerPush).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(sentRoutes()).toEqual([LOGIN_ROUTE, ME_ROUTE]));
  },
};

/**
 * A same-origin ?callbackUrl= is where signing in lands.
 *
 * @summary sign in with a callbackUrl: lands on it
 */
export const SignInToCallbackUrl: Story = {
  tags: ["ai-generated"],
  parameters: { search: "?callbackUrl=%2Fchat%2F123" },
  play: async ({ canvasElement }) => {
    await signIn(canvasElement, "hunter2");
    answerLogin(jsonResponse({ user: account }));

    await expect(
      await within(canvasElement).findByText("Opened /chat/123"),
    ).toBeVisible();
    await expect(routerPush).toHaveBeenCalledWith("/chat/123");
  },
};

/**
 * A protocol-relative ?callbackUrl= points off-site, so signing in lands on
 * home instead (the open-redirect guard).
 *
 * @summary sign in with an off-site callbackUrl: lands on home
 */
export const SignInIgnoresOffSiteCallbackUrl: Story = {
  tags: ["ai-generated"],
  parameters: { search: "?callbackUrl=%2F%2Fevil.com" },
  play: async ({ canvasElement }) => {
    await signIn(canvasElement, "hunter2");
    answerLogin(jsonResponse({ user: account }));

    await expect(
      await within(canvasElement).findByText("Opened /"),
    ).toBeVisible();
    await expect(routerPush).toHaveBeenCalledWith("/");
  },
};

/**
 * Wrong credentials (401) keep the user on the form with "Invalid email or
 * password" and Sign In enabled again.
 *
 * @summary sign in rejected: invalid credentials, no navigation
 */
export const InvalidCredentials: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await signIn(canvasElement, "wrong");
    answerLogin(jsonResponse({ message: "nope" }, 401));

    await expect(
      await canvas.findByText("Invalid email or password"),
    ).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Sign In" })).toBeEnabled();
    await expect(routerPush).not.toHaveBeenCalled();
    await expect(sentRoutes()).toEqual([LOGIN_ROUTE]);
  },
};

/**
 * Any other failure keeps the user on the form with a generic error.
 *
 * @summary sign in fails: generic error, no navigation
 */
export const ServerError: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await signIn(canvasElement, "hunter2");
    answerLogin(jsonResponse({ message: "boom" }, 500));

    await expect(
      await canvas.findByText("Something went wrong. Please try again."),
    ).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Sign In" })).toBeEnabled();
    await expect(routerPush).not.toHaveBeenCalled();
  },
};
