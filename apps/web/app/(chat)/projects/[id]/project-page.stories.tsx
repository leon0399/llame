import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import { ChatProvider } from "@/contexts/chat-context";
import type {
  CreateChatResponse,
  CreationWorkspaceResponse,
} from "@/lib/api/generated/models";
import type { AvailableModel } from "@/lib/services/models/queries";
import * as modelQueries from "@/lib/services/models/queries";
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
const MODEL_CATALOG = {
  defaultModelId: MODEL_ID,
  models: [
    {
      id: MODEL_ID,
      source: "system",
      name: "Model One",
      contextWindowTokens: 128_000,
      input: ["text"],
    },
  ],
} satisfies { defaultModelId: string; models: Array<AvailableModel> };

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
// The Repositories section below the chats: the project's links, the owner's
// repository catalog, and the checkouts the worktree list narrows. This story
// set leaves all three empty; the section's own stories cover their contents.
const PROJECT_LINKS_ROUTE = "GET /api/v1/projects/p1/repositories";
const REPOSITORIES_ROUTE = "GET /api/v1/repositories";
const CHECKOUTS_ROUTE = "GET /api/v1/checkouts";
// The composer's location preview: no link, so the chip names the level to fix
// and the send creates an unbound chat.
const START_LOCATION_ROUTE = "GET /api/v1/projects/p1/start-location";
const CREATE_CHAT_ROUTE = "POST /api/v1/chats";

const tripPlanning = {
  id: "p1",
  ownerUserId: "u1",
  name: "Trip planning",
  description: "Flights, stays and the day-by-day plan.",
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const otherProject = { ...tripPlanning, id: "p2", name: "Acme relaunch" };

let fetchMock: Mock<typeof fetch>;
let createChatResponse = {
  status: 201,
  body: createdChat("created-1", { status: "unbound" }),
};
let projects: Array<typeof tripPlanning>;
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
  return new Promise<Response>((resolve) => {
    onHold(() => resolve(jsonResponse(body)));
  });
}

function routeFetch() {
  fetchMock = stubFetch();
  fetchMock.mockImplementation((input) => {
    const key = routeOf(input);
    if (key === PROJECTS_ROUTE) {
      return answer(projects, (release) => (releaseProjects = release));
    }
    if (key === PINNED_CHATS_ROUTE) return Promise.resolve(jsonResponse([]));
    if (key === CHATS_ROUTE) {
      return answer([], (release) => (releaseChats = release));
    }
    if (key === PINS_ROUTE) return Promise.resolve(jsonResponse([]));
    if (key === PROJECT_LINKS_ROUTE) return Promise.resolve(jsonResponse([]));
    if (key === REPOSITORIES_ROUTE) return Promise.resolve(jsonResponse([]));
    if (key === CHECKOUTS_ROUTE) return Promise.resolve(jsonResponse([]));
    if (key === START_LOCATION_ROUTE) {
      return Promise.resolve(
        jsonResponse({
          projectId: "p1",
          repositoryId: null,
          executorId: null,
          checkoutId: null,
          isolation: "reuse",
          isolationReason: "no_link",
          isolationChats: 0,
        }),
      );
    }
    if (key === CREATE_CHAT_ROUTE) {
      return Promise.resolve(
        jsonResponse(createChatResponse.body, createChatResponse.status),
      );
    }
    throw new Error(`unrouted fetch in story: ${key}`);
  });
}

/** "METHOD /path?query" of every request sent so far, in order. */
function sentRoutes() {
  return fetchMock.mock.calls.map(([input, init]) => routeOf(input, init));
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
        <ProjectPage />
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
    // The composer is enabled and its chip names the level to fix: this
    // project links no repository, so a send creates an unbound chat (#1328).
    await expect(
      canvas.getByPlaceholderText("Describe a task or ask a question"),
    ).not.toBeDisabled();
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Send message" }),
      ).toBeEnabled(),
    );
    await expect(
      await canvas.findByRole("button", { name: /Chat location/ }),
    ).toHaveTextContent("Trip planning · Choose a repository");
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
      REPOSITORIES_ROUTE,
      CHECKOUTS_ROUTE,
      START_LOCATION_ROUTE,
    ]);
  },
};

/**
 * The side panel previews project settings that do not exist yet (#1329,
 * #1330): Instructions' action flips between its empty state and sample
 * text, and Context's + adds sample cards that their own remove button takes
 * away. Nothing is sent.
 *
 * @summary demo side panel: instructions toggle, context cards add and remove
 */
export const SidePanelDemo: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const panel = within(
      await canvas.findByRole("complementary", { name: "Project settings" }),
    );

    await expect(
      panel.getByText("Add instructions to tailor llame's responses"),
    ).toBeVisible();
    await userEvent.click(
      panel.getByRole("button", { name: "Add instructions" }),
    );
    await expect(
      panel.getByRole("button", { name: "Edit instructions" }),
    ).toBeVisible();
    await expect(
      panel.queryByText("Add instructions to tailor llame's responses"),
    ).not.toBeInTheDocument();

    await userEvent.click(panel.getByRole("button", { name: "Add context" }));
    await userEvent.click(panel.getByRole("button", { name: "Add context" }));
    const cards = within(panel.getByRole("list", { name: "Project context" }));
    await expect(cards.getAllByRole("listitem")).toHaveLength(2);

    await userEvent.click(
      cards.getByRole("button", { name: "Remove Design notes.pdf" }),
    );
    await expect(cards.getAllByRole("listitem")).toHaveLength(1);
    await expect(sentRoutes()).toEqual([
      PROJECTS_ROUTE,
      PINNED_CHATS_ROUTE,
      CHATS_ROUTE,
      PINS_ROUTE,
      PROJECT_LINKS_ROUTE,
      REPOSITORIES_ROUTE,
      CHECKOUTS_ROUTE,
      START_LOCATION_ROUTE,
    ]);
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
        modelId: MODEL_ID,
        parts: [{ type: "text", text: "Start here" }],
      },
    });
    // This project links no repository, so the chip sent no location and no
    // worktree: the server resolves nothing and creates an unbound chat.
    await expect(body.repositoryId).toBeUndefined();
    await expect(body.executorId).toBeUndefined();
    await expect(body.checkoutId).toBeUndefined();
    await expect(body.worktree).toBeUndefined();
    await expect(composer).toHaveValue("");
  },
};

/**
 * A `workspace` failure leaves the chat filed and unbound and stores no
 * message, so the draft stays, the chip warns, and the resend reuses the same
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
    await expect(
      await canvas.findByRole("button", {
        name: /Warning: git refused the path/,
      }),
    ).toBeVisible();
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
