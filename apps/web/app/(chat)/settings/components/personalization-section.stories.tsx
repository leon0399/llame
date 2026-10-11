import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import type { PersonalizationResponse } from "@/lib/services/personalization/types";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";
import { PersonalizationSection } from "./personalization-section";

// No hook mocking: the real personalization query and mutation, and the
// account query the preview reads, run against a stubbed globalThis.fetch. A
// story can hold the settings load or a PATCH until it releases it, to observe
// the card while the server has not answered. An unrouted request fails the
// story.
const LOAD_ROUTE = "GET /api/v1/me/personalization";
const SAVE_ROUTE = "PATCH /api/v1/me/personalization";
const ME_ROUTE = "GET /auth/v1/me";

const NAME_LABEL = "What should the assistant call you?";
const SKELETON_DESCRIPTION =
  "What the assistant knows about you, and how you want it to answer.";
const FORM_DESCRIPTION =
  "What the assistant knows about you, and how you want it to answer. Everything here is sent with every message you write.";

let fetchMock: Mock<typeof fetch>;
let stored: PersonalizationResponse;
let holdLoad: boolean;
let holdSave: boolean;
let failSave: boolean;
let releases: Array<() => void>;

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

function requestOf(input: RequestInfo | URL) {
  return input instanceof Request ? input : new Request(input);
}

/** "METHOD /path" a fetch call targets. */
function routeOf(input: RequestInfo | URL) {
  const request = requestOf(input);
  return `${request.method} ${new URL(request.url).pathname}`;
}

/** "METHOD /path" of every request sent so far, in order. */
function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => routeOf(input));
}

/** The JSON body of every PATCH sent so far, in order. */
function savedBodies(): Promise<Array<unknown>> {
  return Promise.all(
    fetchMock.mock.calls
      .map(([input]) => requestOf(input))
      .filter((request) => request.method === "PATCH")
      .map((request) => request.clone().json()),
  );
}

/** `respond()` now, or — while the story holds this request — once released. */
function answer(hold: boolean, respond: () => Response) {
  if (!hold) return Promise.resolve(respond());
  return new Promise<Response>((resolve) => {
    releases.push(() => resolve(respond()));
  });
}

function releaseHeld() {
  for (const release of releases.splice(0)) release();
}

function routeFetch() {
  fetchMock = stubFetch();
  fetchMock.mockImplementation(async (input) => {
    const request = requestOf(input);
    const key = routeOf(request);
    // Signed out: the preview has no account to show, which it never needs
    // while account sharing is off.
    if (key === ME_ROUTE) return new Response(null, { status: 401 });
    if (key === LOAD_ROUTE) {
      return answer(holdLoad, () => jsonResponse(stored));
    }
    if (key === SAVE_ROUTE) {
      const body: Partial<PersonalizationResponse> = await request
        .clone()
        .json();
      return answer(holdSave, () => {
        if (failSave) return new Response(null, { status: 500 });
        stored = { ...stored, ...body };
        return jsonResponse(stored);
      });
    }
    throw new Error(`unrouted fetch in story: ${key}`);
  });
}

const meta = {
  component: PersonalizationSection,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  beforeEach: () => {
    stored = personalization();
    holdLoad = false;
    holdSave = false;
    failSave = false;
    releases = [];
    routeFetch();
    return () => {
      vi.unstubAllGlobals();
    };
  },
} satisfies Meta<typeof PersonalizationSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The settings form's controls, once the settings have loaded. */
async function formControls(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const name = await canvas.findByLabelText(NAME_LABEL);
  return {
    canvas,
    name,
    about: canvas.getByLabelText("About you"),
    answerStyle: canvas.getByLabelText("How should it answer?"),
    master: canvas.getByRole("switch", { name: "Use my personalization" }),
    share: canvas.getByRole("switch", {
      name: "Share my account name and email",
    }),
    save: canvas.getByRole("button", { name: "Save" }),
  };
}

/**
 * While the settings load the card shows its shorter description over
 * placeholder rows; once they land, the full form takes over with the
 * description that says everything here is sent with every message.
 *
 * @summary the loading card, then the form once settings load
 */
export const LoadingThenForm: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    holdLoad = true;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(sentRoutes()).toEqual([LOAD_ROUTE, ME_ROUTE]));
    await expect(canvas.getByText(SKELETON_DESCRIPTION)).toBeVisible();
    await expect(canvas.queryByLabelText(NAME_LABEL)).not.toBeInTheDocument();

    releaseHeld();

    await expect(await canvas.findByLabelText(NAME_LABEL)).toBeVisible();
    await expect(canvas.getByText(FORM_DESCRIPTION)).toBeVisible();
    await expect(
      canvas.queryByText(SKELETON_DESCRIPTION),
    ).not.toBeInTheDocument();
    await expect(sentRoutes()).toEqual([LOAD_ROUTE, ME_ROUTE]);
  },
};

/**
 * Turning off "Use my personalization" saves `{ enabled: false }` at once: the
 * switch reads off and the fields it gates lock before the server answers,
 * and the settings reload once it has.
 *
 * @summary the master switch turning personalization off immediately
 */
export const TurnPersonalizationOff: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    holdSave = true;
  },
  play: async ({ canvasElement }) => {
    const { master, name, save } = await formControls(canvasElement);
    await expect(master).toBeChecked();
    await expect(name).toBeEnabled();

    await userEvent.click(master);

    await waitFor(() =>
      expect(sentRoutes()).toEqual([LOAD_ROUTE, ME_ROUTE, SAVE_ROUTE]),
    );
    // The server has not answered yet.
    await expect(master).not.toBeChecked();
    await expect(name).toBeDisabled();
    await expect(save).toBeDisabled();
    await expect(savedBodies()).resolves.toEqual([{ enabled: false }]);

    releaseHeld();

    await waitFor(() =>
      expect(sentRoutes()).toEqual([
        LOAD_ROUTE,
        ME_ROUTE,
        SAVE_ROUTE,
        LOAD_ROUTE,
      ]),
    );
    await expect(master).not.toBeChecked();
    await expect(name).toBeDisabled();
  },
};

/**
 * With personalization off, every field it gates is locked: the three text
 * fields, account sharing (which ignores a click) and Save. The preview says
 * nothing is sent, even though a preferred name is stored.
 *
 * @summary personalization off: locked fields and a preview of nothing
 */
export const PersonalizationOff: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    stored = personalization({ enabled: false, preferredName: "Leo" });
  },
  play: async ({ canvasElement }) => {
    const { canvas, name, about, answerStyle, master, share, save } =
      await formControls(canvasElement);

    await expect(master).not.toBeChecked();
    await expect(name).toBeDisabled();
    await expect(about).toBeDisabled();
    await expect(answerStyle).toBeDisabled();
    await expect(save).toBeDisabled();
    await expect(share).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(share);
    await expect(share).not.toBeChecked();

    await userEvent.click(canvas.getByRole("button", { name: "Show" }));

    await expect(
      canvas.getByText(
        "Nothing. No personalization is added to your messages.",
      ),
    ).toBeVisible();
    await expect(
      canvas.queryByText("Preferred name:", { exact: false }),
    ).not.toBeInTheDocument();
    await expect(sentRoutes()).toEqual([LOAD_ROUTE, ME_ROUTE]);
  },
};

/**
 * An edit marks the form "Unsaved changes" and enables Save. Saving sends all
 * three text fields, trimmed and with the empty ones cleared; Save stays busy
 * and the edit stays unsaved until the server answers, then the field reads
 * back the stored value and the marker clears.
 *
 * @summary editing a field and saving it
 */
export const EditAndSave: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    holdSave = true;
  },
  play: async ({ canvasElement }) => {
    const { canvas, name, save } = await formControls(canvasElement);
    await expect(save).toBeDisabled();
    await expect(canvas.queryByText("Unsaved changes")).not.toBeInTheDocument();

    await userEvent.type(name, "Leo ");

    await expect(canvas.getByText("Unsaved changes")).toBeVisible();
    await expect(save).toBeEnabled();

    await userEvent.click(save);

    await waitFor(() =>
      expect(sentRoutes()).toEqual([LOAD_ROUTE, ME_ROUTE, SAVE_ROUTE]),
    );
    await expect(savedBodies()).resolves.toEqual([
      { preferredName: "Leo", about: null, responsePreferences: null },
    ]);
    // The server has not answered yet.
    await expect(save).toBeDisabled();
    await expect(canvas.getByText("Unsaved changes")).toBeVisible();
    await expect(name).toHaveValue("Leo ");

    releaseHeld();

    await waitFor(() =>
      expect(canvas.queryByText("Unsaved changes")).not.toBeInTheDocument(),
    );
    await expect(name).toHaveValue("Leo");
    await expect(save).toBeDisabled();
    await waitFor(() =>
      expect(sentRoutes()).toEqual([
        LOAD_ROUTE,
        ME_ROUTE,
        SAVE_ROUTE,
        LOAD_ROUTE,
      ]),
    );
  },
};

/**
 * Near its cap a field counts down what is left; one character over, the
 * field is marked invalid, the counter reads how far over it is, and Save is
 * blocked with a message to trim the marked fields.
 *
 * @summary a field over its cap blocks Save
 */
export const OverTheCap: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    // The preferred name's cap is 255 characters.
    stored = personalization({ preferredName: "x".repeat(255) });
  },
  play: async ({ canvasElement }) => {
    const { canvas, name, save } = await formControls(canvasElement);
    await expect(canvas.getByText("0 left")).toBeVisible();
    await expect(name).toBeValid();

    await userEvent.type(name, "x");

    await expect(canvas.getByText("1 over the limit")).toBeVisible();
    await expect(name).toBeInvalid();
    await expect(
      canvas.getByText("Too long to save — trim the fields marked above."),
    ).toBeVisible();
    await expect(canvas.queryByText("Unsaved changes")).not.toBeInTheDocument();
    await expect(save).toBeDisabled();
    await expect(sentRoutes()).toEqual([LOAD_ROUTE, ME_ROUTE]);
  },
};

/**
 * When the server rejects a save, the form says it could not save, keeps the
 * edit as unsaved, and leaves Save enabled to try again.
 *
 * @summary a rejected save keeps the edit and offers a retry
 */
export const SaveFails: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    failSave = true;
  },
  play: async ({ canvasElement }) => {
    const { canvas, name, save } = await formControls(canvasElement);

    await userEvent.type(name, "Leo");
    await userEvent.click(save);

    await expect(
      await canvas.findByText("Could not save. Try again."),
    ).toBeVisible();
    await expect(canvas.getByText("Unsaved changes")).toBeVisible();
    await expect(name).toHaveValue("Leo");
    await expect(save).toBeEnabled();
    await expect(savedBodies()).resolves.toEqual([
      { preferredName: "Leo", about: null, responsePreferences: null },
    ]);
    await waitFor(() =>
      expect(sentRoutes()).toEqual([
        LOAD_ROUTE,
        ME_ROUTE,
        SAVE_ROUTE,
        LOAD_ROUTE,
      ]),
    );
  },
};

/**
 * Show opens the preview of exactly what the assistant receives — the stored
 * preferred name inside its personalization fence — and Hide closes it again.
 *
 * @summary showing and hiding the preview of what is sent
 */
export const ShowAndHidePreview: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    stored = personalization({ preferredName: "Leo" });
  },
  play: async ({ canvasElement }) => {
    const { canvas } = await formControls(canvasElement);
    const show = canvas.getByRole("button", { name: "Show" });
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await expect(
      canvas.queryByText("Preferred name: Leo"),
    ).not.toBeInTheDocument();

    await userEvent.click(show);

    const hide = canvas.getByRole("button", { name: "Hide" });
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText("Preferred name: Leo")).toBeVisible();
    await expect(canvas.getByText("<user_personalization>")).toBeVisible();
    await expect(canvas.getByText("</user_personalization>")).toBeVisible();

    await userEvent.click(hide);

    await expect(canvas.getByRole("button", { name: "Show" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(
      canvas.queryByText("Preferred name: Leo"),
    ).not.toBeInTheDocument();
    await expect(sentRoutes()).toEqual([LOAD_ROUTE, ME_ROUTE]);
  },
};
