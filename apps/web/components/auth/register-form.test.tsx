// @vitest-environment jsdom

/**
 * next/navigation is the external boundary (permitted mock target) — the
 * form's useRouter() has no in-process seam otherwise. register() runs for
 * real against a stubbed globalThis.fetch.
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

import { RegisterForm } from "./register-form";

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
});

afterEach(() => {
  routerPushMock.mockReset();
  vi.unstubAllGlobals();
  cleanup();
});

function renderForm() {
  return render(
    <QueryClientProvider client={queryClient}>
      <RegisterForm />
    </QueryClientProvider>,
  );
}

async function fillAndSubmit(fields: {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Name"), fields.name);
  await user.type(screen.getByLabelText("Email"), fields.email);
  await user.type(screen.getByLabelText("Password"), fields.password);
  await user.type(
    screen.getByLabelText("Confirm Password"),
    fields.confirmPassword,
  );
  await user.click(screen.getByRole("button", { name: /create account/i }));
}

describe("RegisterForm", () => {
  it("submits, seeds the me cache, and redirects to '/'", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: account }));

    renderForm();
    await fillAndSubmit({
      name: "Leo",
      email: "leo@example.com",
      password: "hunter2pass",
      confirmPassword: "hunter2pass",
    });

    await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith("/"));
    expect(queryClient.getQueryData(authQueryKeys.me)).toEqual(account);
    const request = requestFromCall(fetchMock);
    expect(new URL(request.url).pathname).toBe("/auth/v1/register");
    await expect(request.clone().json()).resolves.toEqual({
      name: "Leo",
      email: "leo@example.com",
      password: "hunter2pass",
    });
  });

  it("blocks submission when the passwords don't match, without calling fetch", async () => {
    renderForm();
    await fillAndSubmit({
      name: "Leo",
      email: "leo@example.com",
      password: "hunter2pass",
      confirmPassword: "different",
    });

    expect(await screen.findByText("Passwords don't match")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a generic 'Registration failed' error on a failed request", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "boom" }, 500));

    renderForm();
    await fillAndSubmit({
      name: "Leo",
      email: "leo@example.com",
      password: "hunter2pass",
      confirmPassword: "hunter2pass",
    });

    expect(await screen.findByText("Registration failed")).toBeTruthy();
    expect(routerPushMock).not.toHaveBeenCalled();
  });
});
