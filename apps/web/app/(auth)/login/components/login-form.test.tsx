// @vitest-environment jsdom

/**
 * next/navigation is the external boundary (permitted mock target) — the
 * form's useRouter() has no in-process seam otherwise. login() runs for real
 * against a stubbed globalThis.fetch, so an "Invalid email or password"
 * assertion proves the real InvalidCredentialsError mapping (401 -> that
 * copy), not an echoed mock.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { authQueryKeys } from "@/lib/services/auth/queries";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";

const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

import { LoginForm } from "./login-form";

let fetchMock: Mock<typeof fetch>;
let queryClient: QueryClient;

const account = {
  id: "u1",
  name: "Leo",
  email: "leo@example.com",
  emailVerified: null,
  image: null,
};

beforeEach(() => {
  fetchMock = stubFetch();
  queryClient = new QueryClient();
  window.history.pushState(null, "", "/login");
});

afterEach(() => {
  routerPushMock.mockReset();
  vi.unstubAllGlobals();
  cleanup();
});

function renderForm() {
  return render(
    <QueryClientProvider client={queryClient}>
      <LoginForm />
    </QueryClientProvider>,
  );
}

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginForm", () => {
  it("submits, seeds the me cache, and redirects to '/' when there is no callbackUrl", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: account }));

    renderForm();
    await fillAndSubmit("leo@example.com", "hunter2");

    await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith("/"));
    expect(queryClient.getQueryData(authQueryKeys.me)).toEqual(account);
    const request = requestFromCall(fetchMock);
    expect(new URL(request.url).pathname).toBe("/auth/v1/login");
    await expect(request.clone().json()).resolves.toEqual({
      email: "leo@example.com",
      password: "hunter2",
    });
  });

  it("redirects to a same-origin callbackUrl", async () => {
    window.history.pushState(null, "", "/login?callbackUrl=%2Fchat%2F123");
    fetchMock.mockResolvedValue(jsonResponse({ user: account }));

    renderForm();
    await fillAndSubmit("leo@example.com", "hunter2");

    await waitFor(() =>
      expect(routerPushMock).toHaveBeenCalledWith("/chat/123"),
    );
  });

  it("falls back to '/' for a protocol-relative callbackUrl (open-redirect guard)", async () => {
    window.history.pushState(null, "", "/login?callbackUrl=%2F%2Fevil.com");
    fetchMock.mockResolvedValue(jsonResponse({ user: account }));

    renderForm();
    await fillAndSubmit("leo@example.com", "hunter2");

    await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith("/"));
  });

  it("shows 'Invalid email or password' on a 401, without redirecting", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "nope" }, 401));

    renderForm();
    await fillAndSubmit("leo@example.com", "wrong");

    expect(await screen.findByText("Invalid email or password")).toBeTruthy();
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("shows a generic error for a non-401 failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "boom" }, 500));

    renderForm();
    await fillAndSubmit("leo@example.com", "hunter2");

    expect(
      await screen.findByText("Something went wrong. Please try again."),
    ).toBeTruthy();
  });
});
