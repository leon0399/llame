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
import { RegisterForm } from "./register-form";

// No hook mocking: the real register() and useMe() run against a stubbed
// globalThis.fetch. The register POST is held until a story answers it, so
// the pending state is observable; the destination's session refetch is never
// answered, so whatever user it shows came from the cache the form seeded. An
// unrouted request fails the story.
const REGISTER_ROUTE = "POST /auth/v1/register";
const ME_ROUTE = "GET /auth/v1/me";

const account = {
  id: "u1",
  name: "Leo",
  email: "leo@example.com",
  emailVerified: null,
  image: null,
};

let fetchMock: Mock<typeof fetch>;
let answerRegister: (response: Response) => void;

/** The "METHOD /path" a fetch call targets. */
function routeOf(input: RequestInfo | URL) {
  const request = input instanceof Request ? input : new Request(input);
  return `${request.method} ${new URL(request.url).pathname}`;
}

/** Every request the story sent, in order, as "METHOD /path". */
function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => routeOf(input));
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

/** The register page until the form navigates, then the destination. */
function RegisterThenDestination() {
  const [href, setHref] = useState<string>();
  useEffect(() => {
    navigate = setHref;
    return () => {
      navigate = undefined;
    };
  }, []);
  return href === undefined ? <RegisterForm /> : <Destination href={href} />;
}

const meta = {
  component: RegisterForm,
  tags: ["autodocs"],
  parameters: { nextjs: { router: { push: routerPush } } },
  beforeEach: () => {
    routerPush.mockClear();
    fetchMock = stubFetch();
    fetchMock.mockImplementation((input) => {
      const key = routeOf(input);
      if (key === REGISTER_ROUTE) {
        return new Promise<Response>((resolve) => {
          answerRegister = resolve;
        });
      }
      if (key === ME_ROUTE) return new Promise<Response>(() => {});
      throw new Error(`unrouted fetch in story: ${key}`);
    });
    return () => {
      vi.unstubAllGlobals();
    };
  },
  render: () => <RegisterThenDestination />,
} satisfies Meta<typeof RegisterForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Fills the form, confirming `confirmPassword`, and presses Create account. */
async function createAccount(
  canvasElement: HTMLElement,
  confirmPassword: string,
) {
  const canvas = within(canvasElement);
  await userEvent.type(canvas.getByLabelText("Name"), "Leo");
  await userEvent.type(canvas.getByLabelText("Email"), "leo@example.com");
  await userEvent.type(canvas.getByLabelText("Password"), "hunter2pass");
  await userEvent.type(
    canvas.getByLabelText("Confirm Password"),
    confirmPassword,
  );
  await userEvent.click(canvas.getByRole("button", { name: "Create account" }));
}

/**
 * Creating an account sends the name, email and password (never the
 * confirmation), shows Creating account... until the server answers, then
 * opens the home page already signed in as the new user, before the home
 * page's own session request comes back.
 *
 * @summary create account: pending, then home as the new user
 */
export const CreateAccount: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await createAccount(canvasElement, "hunter2pass");

    await waitFor(() => expect(sentRoutes()).toEqual([REGISTER_ROUTE]));
    await expect(
      canvas.getByRole("button", { name: "Creating account..." }),
    ).toBeDisabled();
    await expect(requestFromCall(fetchMock).clone().json()).resolves.toEqual({
      name: "Leo",
      email: "leo@example.com",
      password: "hunter2pass",
    });

    answerRegister(jsonResponse({ user: account }));

    await expect(await canvas.findByText("Opened /")).toBeVisible();
    await expect(canvas.getByText("Signed in as Leo")).toBeVisible();
    await expect(routerPush).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(sentRoutes()).toEqual([REGISTER_ROUTE, ME_ROUTE]),
    );
  },
};

/**
 * A confirmation that differs from the password is flagged on the form, and
 * nothing is sent.
 *
 * @summary passwords don't match: flagged, nothing sent
 */
export const PasswordMismatch: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await createAccount(canvasElement, "different");

    await expect(
      await canvas.findByText("Passwords don't match"),
    ).toBeVisible();
    await expect(fetchMock).not.toHaveBeenCalled();
    await expect(routerPush).not.toHaveBeenCalled();
  },
};

/**
 * A failed request keeps the user on the form with "Registration failed" and
 * Create account enabled again.
 *
 * @summary create account fails: error, no navigation
 */
export const RegistrationFailed: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await createAccount(canvasElement, "hunter2pass");
    await waitFor(() => expect(sentRoutes()).toEqual([REGISTER_ROUTE]));
    answerRegister(jsonResponse({ message: "boom" }, 500));

    await expect(await canvas.findByText("Registration failed")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Create account" }),
    ).toBeEnabled();
    await expect(routerPush).not.toHaveBeenCalled();
    await expect(sentRoutes()).toEqual([REGISTER_ROUTE]);
  },
};
