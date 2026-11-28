import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";
import AccountSettingsPage from "../account/page";

// The real account query runs against a stubbed globalThis.fetch. Confirming
// "Sign out everywhere" revokes every session and sends the page to the login
// screen, so no story confirms it.
const ME_ROUTE = "GET /auth/v1/me";

let fetchMock: Mock<typeof fetch>;
let name: string | null;
let failMe: boolean;

function routeOf(input: RequestInfo | URL) {
  const request = input instanceof Request ? input : new Request(input);

  return `${request.method} ${new URL(request.url).pathname}`;
}

const meta = {
  component: AccountSettingsPage,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  beforeEach: () => {
    name = "Leo";
    failMe = false;
    fetchMock = stubFetch();
    fetchMock.mockImplementation(async (input) => {
      const key = routeOf(input);

      if (key === ME_ROUTE) {
        if (failMe) return new Response(null, { status: 500 });

        return jsonResponse({
          id: "user-1",
          name,
          email: "leo@example.com",
          emailVerified: null,
          image: null,
        });
      }

      throw new Error(`unrouted fetch in story: ${key}`);
    });

    return () => {
      vi.unstubAllGlobals();
    };
  },
} satisfies Meta<typeof AccountSettingsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The page heading, the signed-in account's name and email, then Security:
 * changing the password is coming soon, and every session can be signed out
 * at once.
 *
 * @summary the account's identity and its security settings
 */
export const Default: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      canvas.getByRole("heading", { name: "Account & security", level: 1 }),
    ).toBeVisible();
    await expect(await canvas.findByText("Leo")).toBeVisible();
    await expect(canvas.getByText("leo@example.com")).toBeVisible();
    await expect(
      canvas.getByRole("heading", { name: "Security", level: 2 }),
    ).toBeVisible();
    await expect(canvas.getByText("soon")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Sign out everywhere" }),
    ).toBeEnabled();
  },
};

/**
 * An account without a name reads "Not set" rather than an empty line.
 *
 * @summary an account with no name
 */
export const NoName: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    name = null;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByText("leo@example.com")).toBeVisible();
    await expect(canvas.getByText("Not set")).toBeVisible();
  },
};

/**
 * A failed account read says so and offers a retry, instead of "Not set" for
 * a name and email the account may well have.
 *
 * @summary a failed account read, with a retry
 */
export const LoadFailed: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    failMe = true;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Could not load your account.",
    );
    await expect(canvas.queryByText("Not set")).not.toBeInTheDocument();

    failMe = false;
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));

    await expect(await canvas.findByText("Leo")).toBeVisible();
  },
};

/**
 * "Sign out everywhere" asks first, naming that this session ends too; Cancel
 * closes the dialog and sends nothing.
 *
 * @summary signing out everywhere asks first
 */
export const SignOutEverywhereAsks: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByText("Leo");
    await userEvent.click(
      canvas.getByRole("button", { name: "Sign out everywhere" }),
    );

    const dialog = await screen.findByRole("alertdialog", {
      name: "Sign out of every session?",
    });

    await expect(dialog).toHaveTextContent("this one included");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    // The dialog fades out before it leaves the document.
    await waitFor(
      () => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
      { timeout: 5000 },
    );
    await expect(fetchMock.mock.calls.map(([input]) => routeOf(input))).toEqual(
      [ME_ROUTE],
    );
  },
};
