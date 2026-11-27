import { z } from "zod";

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  expect,
  fireEvent,
  fn,
  screen,
  userEvent,
  waitFor,
  within,
} from "storybook/test";
import { vi, type Mock } from "vitest";

import { ChatProvider } from "@/contexts/chat-context";
import type {
  CreateChatResponse,
  CreationWorkspaceResponse,
} from "@/lib/api/generated/models";
import type { ModelsResponse } from "@/lib/services/models/queries";
import * as modelQueries from "@/lib/services/models/queries";
import type { ProjectResponse } from "@/lib/services/project/types";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";
import ProjectPage from "./page";

const useModelsQuery = vi.mocked(modelQueries.useModelsQuery, {
  partial: true,
});

// The composer unlocks with a loaded catalog; the default model is the one a
// send carries.
const MODEL_ID = "system:openai:model-one";

const MODEL_CATALOG: ModelsResponse = {
  defaultSelector: MODEL_ID,
  models: [
    {
      id: MODEL_ID,
      source: "system",
      name: "Model One",
      contextWindowTokens: 128_000,
      input: ["text"],
    },
  ],
  roles: [],
};

const routerPush = fn().mockName("router.push");

// No hook mocking: the real useProjects, useChatsQuery and usePins run against
// a stubbed globalThis.fetch. The page reads its project id from the route,
// which nextjs-vite provides from the story's `nextjs.navigation.segments`.
// The project list and the project's chats can be held until a story releases
// them, so a story can observe the page while they are still in flight. An
// unrouted request fails the story.
const PROJECTS_ROUTE = "GET /api/v1/projects?archived=with";

const PINNED_CHATS_ROUTE =
  "GET /api/v1/chats?projectId=p1&pinned=only&archived=with";

const CHATS_ROUTE = "GET /api/v1/chats?projectId=p1&pinned=exclude";
const PINS_ROUTE = "GET /api/v1/pins";

// The side panel's Repositories section: the project's links, the owner's
// repository catalog, and the checkouts the worktree list narrows. These
// stories leave all three empty; the section's own stories cover their
// contents.
const PROJECT_LINKS_ROUTE = "GET /api/v1/projects/p1/repositories";
const REPOSITORIES_ROUTE = "GET /api/v1/repositories";
const CHECKOUTS_ROUTE = "GET /api/v1/checkouts";

// The composer's location preview: no link, so no working directory resolves
// and the send creates an unbound chat.
const START_LOCATION_ROUTE = "GET /api/v1/projects/p1/start-location";
const CREATE_CHAT_ROUTE = "POST /api/v1/chats";
const PROJECT_UPDATE_ROUTE = "PATCH /api/v1/projects/p1";

const INSTRUCTIONS_MAX = 16_000;

const tripPlanning: ProjectResponse = {
  id: "p1",
  ownerUserId: "u1",
  name: "Trip planning",
  description: "Flights, stays and the day-by-day plan.",
  instructions: null,
  archivedAt: null,
  defaultExecutorId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const otherProject: ProjectResponse = {
  ...tripPlanning,
  id: "p2",
  name: "Acme relaunch",
};

let fetchMock: Mock<typeof fetch>;

let createChatResponse = {
  status: 201,
  body: createdChat("created-1", { status: "unbound" }),
};

let projects: Array<ProjectResponse>;
let saveFailure: { status: number; body: object } | null;
let failProjectsAfterPatch: boolean;
let failedProjectsReads: number;
let holdRequests: boolean;
let releaseProjects: () => void;
let releaseChats: () => void;

/** A created chat, as `POST /api/v1/chats` answers it. */
function createdChat(
  id: string,
  workspace: CreationWorkspaceResponse,
): CreateChatResponse {
  return {
    chat: {
      id,
      ownerUserId: "u1",
      title: null,
      visibility: "private",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
      projectId: "p1",
      workspaceRoot: null,
      modelSelection: null,
    },
    workspace,
  };
}

/** "METHOD /path?query" a fetch call targets. */
function routeOf(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);

  return `${request.method} ${url.pathname}${url.search}`;
}

/** A response now, or — while a story holds requests — once released. */
function answer(body: Array<object>, onHold: (release: () => void) => void) {
  if (!holdRequests) return Promise.resolve(jsonResponse(body));

  // Executor form: apps/web's TypeScript lib predates Promise.withResolvers.
  return new Promise<Response>((resolve) => {
    onHold(() => resolve(jsonResponse(body)));
  });
}

const instructionPatchSchema = z.object({
  instructions: z.string().nullable().optional(),
  archived: z.boolean().optional(),
});

type InstructionPatch = z.infer<typeof instructionPatchSchema>;

/** The API's Project update: instruction text is kept literally, `null` or
 *  whitespace clears it, the exact code-point bound is enforced, archive state
 *  flips, and a mutation failure leaves the stored Project untouched. */
function patchProject(patch: InstructionPatch): Response {
  if (saveFailure !== null) {
    return jsonResponse(saveFailure.body, saveFailure.status);
  }

  const current = projects.find((project) => project.id === "p1");

  if (current === undefined) {
    return jsonResponse({ statusCode: 404, message: "Not found" }, 404);
  }

  if (current.archivedAt !== null && patch.instructions !== undefined) {
    return jsonResponse({ statusCode: 409, message: "Archived" }, 409);
  }

  let instructions = current.instructions;

  if (patch.instructions !== undefined) {
    if (patch.instructions === null) {
      instructions = null;
    } else if (Array.from(patch.instructions).length > INSTRUCTIONS_MAX) {
      return jsonResponse({ statusCode: 400, message: "Too long" }, 400);
    } else {
      instructions =
        patch.instructions.trim() === "" ? null : patch.instructions;
    }
  }

  let archivedAt = current.archivedAt;

  if (patch.archived !== undefined) {
    archivedAt = patch.archived ? "2026-01-02T00:00:00.000Z" : null;
  }

  const updated: ProjectResponse = {
    ...current,
    instructions,
    archivedAt,
    updatedAt: "2026-01-02T00:00:00.000Z",
  };

  projects = projects.map((project) =>
    project.id === current.id ? updated : project,
  );

  return jsonResponse(updated);
}

function routeFetch() {
  fetchMock = stubFetch();
  fetchMock.mockImplementation(async (input) => {
    const key = routeOf(input);

    if (key === PROJECTS_ROUTE) {
      if (
        failProjectsAfterPatch &&
        sentRoutes().includes(PROJECT_UPDATE_ROUTE)
      ) {
        failedProjectsReads += 1;

        return jsonResponse({ statusCode: 500, message: "Internal" }, 500);
      }

      return answer(projects, (release) => (releaseProjects = release));
    }

    if (key === PINNED_CHATS_ROUTE) return jsonResponse([]);

    if (key === CHATS_ROUTE) {
      return answer([], (release) => (releaseChats = release));
    }

    if (key === PINS_ROUTE) return jsonResponse([]);

    if (key === PROJECT_LINKS_ROUTE) return jsonResponse([]);

    if (key === REPOSITORIES_ROUTE) return jsonResponse([]);

    if (key === CHECKOUTS_ROUTE) return jsonResponse([]);

    if (key === START_LOCATION_ROUTE) {
      return jsonResponse({
        projectId: "p1",
        repositoryId: null,
        executorId: null,
        checkoutId: null,
        isolation: "reuse",
        isolationReason: "no_link",
        isolationChats: 0,
      });
    }

    if (key === CREATE_CHAT_ROUTE) {
      return jsonResponse(createChatResponse.body, createChatResponse.status);
    }

    if (key === PROJECT_UPDATE_ROUTE) {
      const body = input instanceof Request ? await input.clone().json() : null;

      return patchProject(instructionPatchSchema.parse(body));
    }

    throw new Error(`unrouted fetch in story: ${key}`);
  });
}

/** "METHOD /path?query" of every request sent so far, in order. */
function sentRoutes() {
  return fetchMock.mock.calls.map(([input, init]) => routeOf(input, init));
}

/**
 * A story-controlled lifecycle boundary. Activating its hidden control drops
 * the query cache and remounts the page, so a story observes a save the way a
 * browser reload would: no surviving local draft, only the routed API's
 * answer.
 */
function RemountableProjectPage() {
  const queryClient = useQueryClient();
  const [mountKey, setMountKey] = useState(0);

  return (
    <>
      <button
        type="button"
        aria-label="Reload Project page"
        hidden
        data-story-remount-page=""
        onClick={() => {
          queryClient.clear();
          setMountKey((current) => current + 1);
        }}
      />
      <ProjectPage key={mountKey} />
    </>
  );
}

/** The page's settings panel once the page has settled. */
async function settingsPanel(root: HTMLElement) {
  return within(
    await within(root).findByRole("complementary", {
      name: "Project settings",
    }),
  );
}

/** Open the instruction editor from the Instructions section: its card when
 *  instructions are stored, otherwise its call to add some. */
async function openInstructionsEditor(root: HTMLElement) {
  const panel = await settingsPanel(root);

  await userEvent.click(
    await panel.findByRole("button", {
      name: /^(Edit|View|Add) instructions/,
    }),
  );

  const element = await screen.findByRole("dialog", {
    name: "Project instructions",
  });

  // The dialog fades and zooms in; its contents only count as visible once
  // that animation has finished. One frame lets the animation start.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await Promise.all(
    element
      .getAnimations({ subtree: true })
      .map((animation) => animation.finished),
  );

  const dialog = within(element);

  return {
    panel,
    dialog,
    textarea: dialog.getByRole("textbox", { name: "Project instructions" }),
  };
}

/** The editor closes once its save lands. */
async function editorClosed() {
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Project instructions" }),
    ).not.toBeInTheDocument(),
  );
}

/** How many instruction updates have been sent so far. */
function updateCount() {
  return sentRoutes().filter((route) => route === PROJECT_UPDATE_ROUTE).length;
}

/** Remount the page and wait for its fresh project-list read. */
async function reloadProjectPage(canvasElement: HTMLElement) {
  const control = canvasElement.querySelector<HTMLButtonElement>(
    "[data-story-remount-page]",
  );

  if (control === null) throw new Error("story remount control is missing");

  const reads = sentRoutes().filter((route) => route === PROJECTS_ROUTE).length;

  await fireEvent.click(control);

  await waitFor(() =>
    expect(
      sentRoutes().filter((route) => route === PROJECTS_ROUTE).length,
    ).toBeGreaterThan(reads),
  );
}

/** The request body of the most recent instruction update. */
async function lastUpdateBody() {
  const index = sentRoutes().lastIndexOf(PROJECT_UPDATE_ROUTE);

  if (index < 0) throw new Error("no instruction update was sent");

  return requestFromCall(fetchMock, index).clone().json();
}

const meta = {
  component: ProjectPage,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    nextjs: {
      navigation: { segments: [["id", "p1"]] },
      router: { push: routerPush },
    },
  },
  beforeEach: () => {
    projects = [otherProject, tripPlanning];
    saveFailure = null;
    failProjectsAfterPatch = false;
    failedProjectsReads = 0;
    holdRequests = false;
    createChatResponse = {
      status: 201,
      body: createdChat("created-1", { status: "unbound" }),
    };
    useModelsQuery.mockReturnValue({
      data: MODEL_CATALOG,
      isError: false,
      isPending: false,
      isSuccess: true,
    });
    routerPush.mockClear();
    routeFetch();

    return () => {
      vi.unstubAllGlobals();
    };
  },
  render: () => (
    <ChatProvider>
      <SidebarProvider>
        <RemountableProjectPage />
      </SidebarProvider>
    </ChatProvider>
  ),
} satisfies Meta<typeof ProjectPage>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * While the project list and the project's chats are still loading, the
 * header shows a placeholder title over four placeholder rows; once both land,
 * the project's name replaces them.
 *
 * @summary loading: placeholder title and rows until the lists land
 */
export const Loading: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    holdRequests = true;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("…")).toBeVisible();
    await expect(canvas.getAllByRole("listitem")).toHaveLength(4);
    await waitFor(() =>
      expect(sentRoutes()).toEqual([
        PROJECTS_ROUTE,
        PINNED_CHATS_ROUTE,
        CHATS_ROUTE,
        PINS_ROUTE,
      ]),
    );

    releaseProjects();
    releaseChats();

    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Trip planning" }),
    ).toBeVisible();
    await expect(canvas.queryByText("…")).not.toBeInTheDocument();
    await expect(canvas.queryAllByRole("listitem")).toHaveLength(0);
  },
};

/**
 * No project in the list has the route's id: the header says the project was
 * not found, with a note that it doesn't exist or was deleted.
 *
 * @summary not found: the route's id matches no project
 */
export const NotFound: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    projects = [otherProject];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByText("Project not found")).toBeVisible();
    await expect(
      canvas.getByText("This project doesn't exist or was deleted."),
    ).toBeVisible();
    await expect(canvas.queryByText("Acme relaunch")).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("region", { name: "Chats in this project" }),
    ).not.toBeInTheDocument();
  },
};

/**
 * The route's project heads the content with its name, its description, a
 * pin toggle and its menu, and its chats list, under its own heading, says
 * it has none yet. The page asks the server for this project's chats only.
 *
 * @summary a project with no chats: its header and the empty chats list
 */
export const NoChats: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Trip planning" }),
    ).toBeVisible();
    await expect(
      canvas.getByText("Flights, stays and the day-by-day plan."),
    ).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Pin" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "More" })).toBeVisible();
    // The composer is enabled, its project chip names this project and is
    // fixed here, and this project links no repository, so there is no
    // working-directory pill and a send creates an unbound chat (#1328).
    await expect(
      canvas.getByPlaceholderText("Describe a task or ask a question"),
    ).not.toBeDisabled();
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Send message" }),
      ).toBeEnabled(),
    );
    await expect(
      await canvas.findByRole("button", { name: "Project Trip planning" }),
    ).toBeDisabled();
    await expect(
      canvas.queryByRole("button", { name: /^Folder, / }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByText("Acme relaunch")).not.toBeInTheDocument();

    const chats = within(
      canvas.getByRole("region", { name: "Chats in this project" }),
    );

    await expect(
      chats.getByText("No chats in this project yet."),
    ).toBeVisible();
    await expect(
      chats.getByRole("button", { name: "View options" }),
    ).toBeVisible();
    await expect(sentRoutes()).toEqual([
      PROJECTS_ROUTE,
      PINNED_CHATS_ROUTE,
      CHATS_ROUTE,
      PINS_ROUTE,
      PROJECT_LINKS_ROUTE,
      CHECKOUTS_ROUTE,
      START_LOCATION_ROUTE,
      REPOSITORIES_ROUTE,
    ]);
  },
};

/**
 * Typing guidance and saving persists it: the PATCH carries the literal text,
 * the editor closes, and the section's card shows the stored text. After a
 * remount — the query cache dropped, the page reloaded — the editor opens on
 * the stored text with nothing to save.
 *
 * @summary saved instructions are literal and survive a remount
 */
export const SavesInstructionsAndReloads: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const { panel, dialog, textarea } =
      await openInstructionsEditor(canvasElement);

    const save = dialog.getByRole("button", { name: "Save" });

    await expect(
      dialog.getByText(/sent to your model provider/i),
    ).toBeVisible();
    await expect(textarea).toHaveValue("");
    await expect(save).toBeDisabled();

    await userEvent.type(textarea, "Prefer small, reversible changes.");
    // The count stays hidden until the text nears the cap.
    await expect(dialog.queryByText(/characters$/)).not.toBeInTheDocument();
    await expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => expect(sentRoutes()).toContain(PROJECT_UPDATE_ROUTE));
    await expect(lastUpdateBody()).resolves.toEqual({
      instructions: "Prefer small, reversible changes.",
    });
    await editorClosed();
    await expect(
      await panel.findByRole("button", { name: "Edit instructions" }),
    ).toHaveAccessibleDescription("Prefer small, reversible changes.");

    await reloadProjectPage(canvasElement);

    const reloaded = await openInstructionsEditor(canvasElement);
    await expect(reloaded.textarea).toHaveValue(
      "Prefer small, reversible changes.",
    );
    await expect(
      reloaded.dialog.getByRole("button", { name: "Save" }),
    ).toBeDisabled();
  },
};

/**
 * Emptying the editor and saving sends `null`; the section falls back to its
 * call to add instructions, and stays there after a remount.
 *
 * @summary cleared instructions persist as absent through a remount
 */
export const ClearsInstructionsAndReloads: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    projects = [
      otherProject,
      { ...tripPlanning, instructions: "Keep replies short." },
    ];
  },
  play: async ({ canvasElement }) => {
    const { panel, dialog, textarea } =
      await openInstructionsEditor(canvasElement);

    const save = dialog.getByRole("button", { name: "Save" });

    await expect(textarea).toHaveValue("Keep replies short.");
    await expect(save).toBeDisabled();

    await userEvent.clear(textarea);
    await expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => expect(sentRoutes()).toContain(PROJECT_UPDATE_ROUTE));
    await expect(lastUpdateBody()).resolves.toEqual({ instructions: null });
    await editorClosed();
    await expect(
      await panel.findByRole("button", { name: /^Add instructions/ }),
    ).toBeVisible();

    await reloadProjectPage(canvasElement);

    await expect(
      await (
        await settingsPanel(canvasElement)
      ).findByRole("button", { name: /^Add instructions/ }),
    ).toBeVisible();
  },
};

/**
 * A successful save followed by a failed archive-inclusive list read must not
 * fall back to the pre-save text: the section and the reopened editor keep
 * the stored text while the page cannot reload its list.
 *
 * @summary saved instructions stay fresh when the list reload fails
 */
export const KeepsSavedTextWhenReloadFails: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    projects = [
      otherProject,
      { ...tripPlanning, instructions: "Old guidance." },
    ];
    failProjectsAfterPatch = true;
  },
  play: async ({ canvasElement }) => {
    const { panel, dialog, textarea } =
      await openInstructionsEditor(canvasElement);

    await expect(textarea).toHaveValue("Old guidance.");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "New guidance.");
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sentRoutes()).toContain(PROJECT_UPDATE_ROUTE));
    await expect(lastUpdateBody()).resolves.toEqual({
      instructions: "New guidance.",
    });
    await waitFor(() => expect(failedProjectsReads).toBeGreaterThan(0));
    await editorClosed();
    await expect(
      panel.getByRole("button", { name: "Edit instructions" }),
    ).toHaveAccessibleDescription("New guidance.");

    const reopened = await openInstructionsEditor(canvasElement);
    await expect(reopened.textarea).toHaveValue("New guidance.");
  },
};

/**
 * A failed save reports a generic failure, keeps the editor open on the
 * literal draft, and never echoes the server's own message. The retry —
 * through Ctrl+Enter — re-sends the same draft, succeeds and closes the
 * editor.
 *
 * @summary a failed save keeps the draft and a retry saves it
 */
export const KeepsDraftAfterFailedSave: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    saveFailure = {
      status: 500,
      body: { statusCode: 500, message: "Internal" },
    };
  },
  play: async ({ canvasElement }) => {
    const { panel, dialog, textarea } =
      await openInstructionsEditor(canvasElement);

    const save = dialog.getByRole("button", { name: "Save" });
    const draft = "Review the trade-offs first.";

    await userEvent.type(textarea, draft);
    await userEvent.click(save);

    const failure = await dialog.findByRole("alert");
    await expect(failure).toBeVisible();
    await expect(failure).not.toHaveTextContent(draft);
    await expect(textarea).toHaveValue(draft);
    await expect(screen.queryByText("Internal")).not.toBeInTheDocument();
    await expect(save).toBeEnabled();
    await expect(updateCount()).toBe(1);

    saveFailure = null;
    await userEvent.type(textarea, "{Control>}{Enter}{/Control}");

    await waitFor(() => expect(updateCount()).toBe(2));
    await expect(lastUpdateBody()).resolves.toEqual({ instructions: draft });
    await editorClosed();
    await expect(
      panel.getByRole("button", { name: "Edit instructions" }),
    ).toHaveAccessibleDescription(draft);
  },
};

/**
 * An archived Project keeps its instructions readable: the section's card
 * opens them read-only with only Close, and neither typing nor the save
 * shortcut sends an update.
 *
 * @summary an archived project shows instructions read-only
 */
export const ArchivedInstructionsAreReadOnly: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    projects = [
      otherProject,
      {
        ...tripPlanning,
        instructions: "Read-only guidance.",
        archivedAt: "2026-01-02T00:00:00.000Z",
      },
    ];
  },
  play: async ({ canvasElement }) => {
    const panel = await settingsPanel(canvasElement);

    await expect(
      await panel.findByRole("button", { name: "View instructions" }),
    ).toBeVisible();
    await expect(
      panel.queryByRole("button", { name: "Edit instructions" }),
    ).not.toBeInTheDocument();

    const { dialog, textarea } = await openInstructionsEditor(canvasElement);

    await expect(textarea).toHaveValue("Read-only guidance.");
    await expect(textarea).toHaveAttribute("readonly");
    await expect(
      dialog.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    await expect(dialog.getAllByRole("button", { name: "Close" })).not.toEqual(
      [],
    );

    await userEvent.type(textarea, " edited{Control>}{Enter}{/Control}");

    await expect(textarea).toHaveValue("Read-only guidance.");
    await expect(sentRoutes()).not.toContain(PROJECT_UPDATE_ROUTE);
  },
};

/**
 * The bound counts Unicode code points, not UTF-16 units: 16000 astral
 * characters (32000 units) are exactly at the limit and save literally, while
 * 16001 are rejected with the draft retained. No native `maxLength` caps the
 * field first.
 *
 * @summary astral characters count as one code point each
 */
export const AstralCharactersCountAsCodePoints: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const first = await openInstructionsEditor(canvasElement);

    await expect(first.textarea).not.toHaveAttribute("maxlength");

    const atLimit = "😀".repeat(16_000);
    await fireEvent.input(first.textarea, { target: { value: atLimit } });
    await expect(
      await first.dialog.findByText("16,000 / 16,000 characters"),
    ).toBeVisible();
    await expect(first.textarea).toHaveValue(atLimit);
    await expect(first.dialog.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.click(first.dialog.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sentRoutes()).toContain(PROJECT_UPDATE_ROUTE));
    await expect(lastUpdateBody()).resolves.toEqual({ instructions: atLimit });
    await editorClosed();

    const { dialog, textarea } = await openInstructionsEditor(canvasElement);
    const overLimit = "😀".repeat(16_001);
    await fireEvent.input(textarea, { target: { value: overLimit } });
    await expect(
      await dialog.findByText("16,001 / 16,000 characters"),
    ).toBeVisible();
    await expect(textarea).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(textarea).toHaveValue(overLimit);
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(updateCount()).toBe(1);
  },
};

/**
 * Variation selectors are code points too. 16000 base characters each followed
 * by U+FE0F are 32000 code points, so the form rejects them even though the
 * installed server validator used to discount the selectors; 8000 such pairs
 * are exactly 16000 code points and save.
 *
 * @summary variation selectors count separately in the bound
 */
export const VariationSelectorsCountAsCodePoints: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const { dialog, textarea } = await openInstructionsEditor(canvasElement);
    const save = dialog.getByRole("button", { name: "Save" });

    const paired = "a\uFE0F".repeat(16_000);
    await fireEvent.input(textarea, { target: { value: paired } });
    await expect(
      await dialog.findByText("32,000 / 16,000 characters"),
    ).toBeVisible();
    await expect(textarea).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(sentRoutes()).not.toContain(PROJECT_UPDATE_ROUTE);

    const atLimit = "a\uFE0F".repeat(8000);
    await fireEvent.input(textarea, { target: { value: atLimit } });
    await expect(
      await dialog.findByText("16,000 / 16,000 characters"),
    ).toBeVisible();
    await expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
    await expect(save).toBeEnabled();

    await userEvent.click(save);

    await waitFor(() => expect(sentRoutes()).toContain(PROJECT_UPDATE_ROUTE));
    await expect(lastUpdateBody()).resolves.toEqual({ instructions: atLimit });
  },
};

/**
 * The Instructions section is real: no fake Context or sample-file controls
 * remain in the Project settings panel.
 *
 * @summary no fake Context controls remain beside the real editor
 */
export const NoFakeContextControls: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const panel = await settingsPanel(canvasElement);

    await expect(
      await panel.findByRole("heading", { name: "Instructions" }),
    ).toBeVisible();
    await expect(
      panel.queryByRole("button", { name: "Add context" }),
    ).not.toBeInTheDocument();
    await expect(
      panel.queryByRole("list", { name: "Project context" }),
    ).not.toBeInTheDocument();
    await expect(panel.queryByText("Design notes.pdf")).not.toBeInTheDocument();
    await expect(
      panel.queryByText(/Add PDFs, documents, or other text/),
    ).not.toBeInTheDocument();
  },
};

/**
 * One send creates the chat already filed here: `POST /api/v1/chats` carries
 * the project and the message, then the page opens the chat whose stream
 * replays the started Run.
 *
 * @summary a project page send creates the filed chat and opens it
 */
export const SendCreatesFiledChat: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const composer = await canvas.findByPlaceholderText(
      "Describe a task or ask a question",
    );

    await userEvent.type(composer, "Start here");
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Send message" }),
      ).toBeEnabled(),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith("/chat/created-1"),
    );
    const index = sentRoutes().indexOf(CREATE_CHAT_ROUTE);
    expect(index).toBeGreaterThan(-1);
    const body = await requestFromCall(fetchMock, index).clone().json();
    await expect(body).toMatchObject({
      projectId: "p1",
      message: {
        selector: MODEL_ID,
        parts: [{ type: "text", text: "Start here" }],
      },
    });
    // This project links no repository, so the composer named no location and
    // no worktree: the server binds nothing and creates an unbound chat.
    await expect(body.repositoryId).toBeUndefined();
    await expect(body.executorId).toBeUndefined();
    await expect(body.checkoutId).toBeUndefined();
    await expect(body.worktree).toBeUndefined();
    // The textarea remounts when the send locks and unlocks the composer, so
    // the cleared draft is read from the current element.
    await waitFor(() =>
      expect(
        canvas.getByPlaceholderText("Describe a task or ask a question"),
      ).toHaveValue(""),
    );
  },
};

/**
 * A `workspace` failure leaves the chat filed and unbound and stores no
 * message, so the draft stays under the failure sentence, and the resend reuses the same
 * chat id — the server's retry path, not a second chat.
 *
 * @summary a failed workspace keeps the draft and resends the same chat id
 */
export const SendKeepsDraftOnWorkspaceFailure: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    createChatResponse = {
      status: 201,
      body: createdChat("retry-1", {
        status: "worktree_failed",
        message: "git refused the path",
      }),
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const composer = await canvas.findByPlaceholderText(
      "Describe a task or ask a question",
    );

    await userEvent.type(composer, "Fix the base ref");
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Send message" }),
      ).toBeEnabled(),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Send message" }));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "git refused the path",
    );
    await expect(composer).toHaveValue("Fix the base ref");
    await expect(routerPush).not.toHaveBeenCalled();

    await userEvent.click(canvas.getByRole("button", { name: "Send message" }));
    await waitFor(() => {
      const posts = sentRoutes().filter((route) => route === CREATE_CHAT_ROUTE);
      expect(posts).toHaveLength(2);
    });

    const indices = sentRoutes()
      .map((route, index) => (route === CREATE_CHAT_ROUTE ? index : -1))
      .filter((index) => index >= 0);

    const first = await requestFromCall(fetchMock, indices[0]).clone().json();
    const second = await requestFromCall(fetchMock, indices[1]).clone().json();
    // The first send chose a client id; the resend must reuse it, because the
    // server retries the location steps on the stored chat instead of
    // creating a second one.
    await expect(second.id).toBe(first.id);
  },
};
