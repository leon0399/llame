import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { expect, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";
import ProjectPage from "./page";

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
let projects: Array<typeof tripPlanning>;
let holdRequests: boolean;
let releaseProjects: () => void;
let releaseChats: () => void;

/** "METHOD /path?query" a fetch call targets. */
function routeOf(input: RequestInfo | URL) {
  const request = input instanceof Request ? input : new Request(input);
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
    throw new Error(`unrouted fetch in story: ${key}`);
  });
}

/** "METHOD /path?query" of every request sent so far, in order. */
function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => routeOf(input));
}

const meta = {
  component: ProjectPage,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { segments: [["id", "p1"]] } },
  },
  beforeEach: () => {
    projects = [otherProject, tripPlanning];
    holdRequests = false;
    routeFetch();
    return () => {
      vi.unstubAllGlobals();
    };
  },
  render: () => (
    <SidebarProvider>
      <ProjectPage />
    </SidebarProvider>
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
      canvas.queryByText("Chats in this project"),
    ).not.toBeInTheDocument();
  },
};

/**
 * The route's project heads the content with its name, its description, a
 * pin toggle and its menu, and its chats card says it has none yet. The page
 * asks the server for this project's chats only.
 *
 * @summary a project with no chats: its header and the empty chats card
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
    // Starting a chat in the project is not built yet (#1328): the input is
    // there, but neither it nor Send can be used.
    await expect(
      canvas.getByRole("textbox", { name: /New chat in Trip planning/ }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Send — coming soon" }),
    ).toHaveAttribute("aria-disabled", "true");
    await expect(canvas.queryByText("Acme relaunch")).not.toBeInTheDocument();
    await expect(canvas.getByText("Chats in this project")).toBeVisible();
    await expect(
      canvas.getByText("No chats in this project yet."),
    ).toBeVisible();
    await expect(sentRoutes()).toEqual([
      PROJECTS_ROUTE,
      PINNED_CHATS_ROUTE,
      CHATS_ROUTE,
      PINS_ROUTE,
    ]);
  },
};
