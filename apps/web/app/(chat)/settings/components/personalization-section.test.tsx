// @vitest-environment jsdom

/**
 * Container coverage for PersonalizationSection: the field/toggle/save/preview
 * composition sitting on top of the already-unit-tested usePersonalizationDraft
 * hook (see ./use-personalization-draft.test.ts). Real hooks run against a
 * stubbed globalThis.fetch — no first-party module mocking.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";
import type { PersonalizationResponse } from "@/lib/services/personalization/types";

import { PersonalizationSection } from "./personalization-section";

let fetchMock: Mock<typeof fetch>;
let queryClient: QueryClient;

function personalization(
  overrides: Partial<PersonalizationResponse> = {},
): PersonalizationResponse {
  return {
    preferredName: null,
    about: null,
    responsePreferences: null,
    enabled: true,
    shareAccountIdentity: false,
    ...overrides,
  };
}

/** Index of the most recent call whose Request used `method` — several
 * assertions fire after a mutation's onSettled has already kicked off a
 * cache-invalidation refetch, so "the last call" isn't reliably the
 * mutation's own request. */
function lastCallIndex(mock: Mock<typeof fetch>, method: string): number {
  for (let i = mock.mock.calls.length - 1; i >= 0; i--) {
    const request = mock.mock.calls[i]?.[0];
    if (request instanceof Request && request.method === method) return i;
  }
  throw new Error(`no ${method} call recorded`);
}

function switchChecked(el: Element) {
  return el.getAttribute("aria-checked") === "true";
}

function switchDisabled(el: Element) {
  return el.getAttribute("aria-disabled") === "true";
}

/** The "What should the assistant call you?" field is always an <input>
 * (TEXT_FIELDS' only "input"-control row), so this query always resolves to
 * an HTMLInputElement. */
async function findNameInput(): Promise<HTMLInputElement> {
  const el = await screen.findByLabelText(
    "What should the assistant call you?",
  );
  // SAFETY: see comment above — the label is only ever on that <input>.
  return el as HTMLInputElement;
}

/** PersonalizationSaveRow renders exactly one <button> named "Save". */
function findSaveButton(): HTMLButtonElement {
  const el = screen.getByRole("button", { name: /Save/ });
  // SAFETY: getByRole("button", …) only ever resolves to a <button>.
  return el as HTMLButtonElement;
}

function renderSection(
  data: PersonalizationResponse,
  patchHandler?: (request: Request) => Response | Promise<Response>,
) {
  fetchMock = stubFetch();
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/auth/v1/me") return new Response(null, { status: 401 });
    if (pathname === "/api/v1/me/personalization" && request.method === "GET")
      return jsonResponse(data);
    if (
      pathname === "/api/v1/me/personalization" &&
      request.method === "PATCH"
    ) {
      if (patchHandler) return patchHandler(request);
      const body: Partial<PersonalizationResponse> = await request
        .clone()
        .json();
      data = { ...data, ...body };
      return jsonResponse(data);
    }
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <PersonalizationSection />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("PersonalizationSection", () => {
  it("shows the skeleton's shorter description while the query is pending, then the full form", async () => {
    renderSection(personalization());

    expect(
      screen.getByText(
        "What the assistant knows about you, and how you want it to answer.",
      ),
    ).toBeTruthy();

    await waitFor(() =>
      expect(
        screen.getByText(
          "What the assistant knows about you, and how you want it to answer. Everything here is sent with every message you write.",
        ),
      ).toBeTruthy(),
    );
  });

  it("toggles the master switch and PATCHes {enabled: false} immediately", async () => {
    renderSection(personalization({ enabled: true }));

    await waitFor(() =>
      expect(
        screen.getByLabelText("What should the assistant call you?"),
      ).toBeTruthy(),
    );

    const masterSwitch = screen.getByRole("switch", {
      name: "Use my personalization",
    });
    fireEvent.click(masterSwitch);

    await waitFor(() => expect(switchChecked(masterSwitch)).toBe(false));
    const request = requestFromCall(
      fetchMock,
      lastCallIndex(fetchMock, "PATCH"),
    );
    expect(await request.clone().json()).toEqual({ enabled: false });
  });

  it("disables the text fields, share-identity toggle, and Save when the master switch is off", async () => {
    renderSection(personalization({ enabled: false }));

    const nameInput = await findNameInput();
    expect(nameInput.disabled).toBe(true);

    const shareSwitch = screen.getByRole("switch", {
      name: "Share my account name and email",
    });
    expect(switchDisabled(shareSwitch)).toBe(true);

    expect(findSaveButton().disabled).toBe(true);
  });

  it("edits a text field, shows Unsaved changes, saves, and clears the dirty state on success", async () => {
    renderSection(personalization());

    const nameInput = await findNameInput();
    fireEvent.change(nameInput, { target: { value: "Leo" } });

    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    const saveButton = findSaveButton();
    expect(saveButton.disabled).toBe(false);

    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(screen.queryByText("Unsaved changes")).toBeNull(),
    );
    const request = requestFromCall(
      fetchMock,
      lastCallIndex(fetchMock, "PATCH"),
    );
    expect(await request.clone().json()).toEqual({
      preferredName: "Leo",
      about: null,
      responsePreferences: null,
    });
  });

  it("marks an over-cap field, blocks Save, and shows the trim message", async () => {
    renderSection(personalization());

    const nameInput = await findNameInput();
    fireEvent.change(nameInput, { target: { value: "x".repeat(256) } });

    expect(screen.getByText("1 over the limit")).toBeTruthy();
    expect(
      screen.getByText("Too long to save — trim the fields marked above."),
    ).toBeTruthy();
    expect(findSaveButton().disabled).toBe(true);
  });

  it("shows the save-failed message when the PATCH rejects", async () => {
    renderSection(personalization(), () =>
      Promise.resolve(new Response(null, { status: 500 })),
    );

    const nameInput = await findNameInput();
    fireEvent.change(nameInput, { target: { value: "Leo" } });
    fireEvent.click(findSaveButton());

    await waitFor(() =>
      expect(screen.getByText("Could not save. Try again.")).toBeTruthy(),
    );
  });

  it("shows and hides the preview, rendering the projected text when open", async () => {
    renderSection(personalization({ preferredName: "Leo" }));

    await screen.findByLabelText("What should the assistant call you?");

    const toggle = screen.getByRole("button", { name: /Show/ });
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Preferred name:", { exact: false })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Hide/ }));
    expect(screen.queryByText("Preferred name:", { exact: false })).toBeNull();
  });

  it("says nothing is sent when personalization is disabled, even with the preview open", async () => {
    renderSection(personalization({ enabled: false, preferredName: "Leo" }));

    await screen.findByLabelText("What should the assistant call you?");
    fireEvent.click(screen.getByRole("button", { name: /Show/ }));

    expect(
      screen.getByText(
        "Nothing. No personalization is added to your messages.",
      ),
    ).toBeTruthy();
  });
});
