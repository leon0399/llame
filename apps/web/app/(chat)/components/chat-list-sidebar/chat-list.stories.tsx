import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { expect, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import type {
  ChatListItemResponse,
  ProjectResponse,
} from "@/lib/api/generated/models";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";
import { ChatList } from "./chat-list";

// No query hook mocking: the real chat list, projects and pins queries run
// against a stubbed globalThis.fetch. A story can hold any of them until it
// releases it, to observe the rail while that request is in flight. An
// unrouted request fails the story. Activity dots come from the preview's
// active-runs mock, so the runs poll never reaches the network.
const PINNED_ROUTE = "GET /api/v1/chats?pinned=only&archived=with";
const ALL_ROUTE = "GET /api/v1/chats?pinned=exclude";
const PROJECTS_ROUTE = "GET /api/v1/projects";
const PINS_ROUTE = "GET /api/v1/pins";
const RAIL_ROUTES = [PINNED_ROUTE, ALL_ROUTE, PROJECTS_ROUTE, PINS_ROUTE];

const EMPTY_STATE =
  "Your conversations will appear here once you start chatting!";

let fetchMock: Mock<typeof fetch>;
let responses: Map<string, () => Response>;
let held: Set<string>;
let releases: Array<() => void>;

function chat(
  id: string,
  title: string,
  projectId: string | null = null,
): ChatListItemResponse {
  // Updated now, so every chat lands in the Today group.
  const now = new Date().toISOString();
  return {
    id,
    ownerUserId: "u1",
    title,
    lastMessage: null,
    visibility: "private",
    projectId,
    workspaceRoot: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

const acme: ProjectResponse = {
  id: "p1",
  ownerUserId: "u1",
  name: "Acme",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
};

/** "METHOD /path?query" a fetch call targets. */
function routeOf(input: RequestInfo | URL) {
  const request = input instanceof Request ? input : new Request(input);
  const url = new URL(request.url);
  return `${request.method} ${url.pathname}${url.search}`;
}

/** "METHOD /path?query" of every request sent so far, in order. */
function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => routeOf(input));
}

function releaseHeld() {
  for (const release of releases.splice(0)) release();
}

function routeFetch() {
  fetchMock = stubFetch();
  fetchMock.mockImplementation((input) => {
    const key = routeOf(input);
    const respond = responses.get(key);
    if (!respond) throw new Error(`unrouted fetch in story: ${key}`);
    if (!held.has(key)) return Promise.resolve(respond());
    return new Promise<Response>((resolve) => {
      releases.push(() => resolve(respond()));
    });
  });
}

const meta = {
  component: ChatList,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/" } },
  },
  beforeEach: () => {
    // Every list empty unless a story says otherwise.
    responses = new Map([
      [PINNED_ROUTE, () => jsonResponse([])],
      [ALL_ROUTE, () => jsonResponse([])],
      [PROJECTS_ROUTE, () => jsonResponse([])],
      [PINS_ROUTE, () => jsonResponse([])],
    ]);
    held = new Set();
    releases = [];
    routeFetch();
    return () => {
      vi.unstubAllGlobals();
    };
  },
  render: () => (
    // The rail's own surface and width. The padding keeps the rows out from
    // under the test pointer, which rests at the top-left corner and would
    // otherwise hover the first row.
    <SidebarProvider className="min-h-0">
      <div className="w-64 bg-sidebar p-2">
        <ChatList />
      </div>
    </SidebarProvider>
  ),
} satisfies Meta<typeof ChatList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Top edges of `elements`, checked to run strictly top to bottom. */
async function expectTopToBottom(elements: Array<HTMLElement>) {
  const tops = elements.map((element) => element.getBoundingClientRect().top);
  await expect(tops).toEqual([...tops].sort((a, b) => a - b));
  await expect(new Set(tops).size).toBe(elements.length);
}

/**
 * A chat filed into a project still lists under its time group: this rail
 * groups by time only, and has no section for the project.
 *
 * @summary a filed chat under Today, with no project group
 */
export const FiledChatInTimeGroups: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    responses.set(ALL_ROUTE, () =>
      jsonResponse([chat("c1", "Filed chat", "p1")]),
    );
    responses.set(PROJECTS_ROUTE, () => jsonResponse([acme]));
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const row = await canvas.findByRole("link", { name: "Filed chat" });
    const today = canvas.getByText("Today");
    await expect(row).toBeVisible();
    await expect(today).toBeVisible();
    await expectTopToBottom([today, row]);
    await expect(canvas.queryByText("Acme")).not.toBeInTheDocument();
    await expect(sentRoutes()).toEqual(RAIL_ROUTES);
  },
};

/**
 * A failed projects request costs the rail nothing: a chat filed into a
 * project it could not load still lists.
 *
 * @summary chats still list when the projects request fails
 */
export const ProjectsRequestFailed: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    responses.set(ALL_ROUTE, () =>
      jsonResponse([chat("c1", "Filed chat", "missing-project")]),
    );
    responses.set(PROJECTS_ROUTE, () => new Response(null, { status: 500 }));
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByRole("link", { name: "Filed chat" }),
    ).toBeVisible();
    await expect(sentRoutes()).toEqual(RAIL_ROUTES);
  },
};

/**
 * Chats list as soon as they arrive, without waiting for the projects
 * request, which is still held here.
 *
 * @summary chats list while projects are still loading
 */
export const ProjectsStillLoading: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    responses.set(ALL_ROUTE, () => jsonResponse([chat("c1", "Filed chat")]));
    held.add(PROJECTS_ROUTE);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByRole("link", { name: "Filed chat" }),
    ).toBeVisible();
    // The projects request is still unanswered.
    await expect(releases).toHaveLength(1);
    await expect(sentRoutes()).toEqual(RAIL_ROUTES);

    releaseHeld();
  },
};

/**
 * While the chat lists load the rail shows placeholder rows under Today;
 * once they land, the chats replace them.
 *
 * @summary placeholder rows while the chat lists load
 */
export const LoadingChats: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    responses.set(ALL_ROUTE, () => jsonResponse([chat("c1", "Filed chat")]));
    held.add(PINNED_ROUTE);
    held.add(ALL_ROUTE);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(sentRoutes()).toEqual(RAIL_ROUTES));
    await expect(canvas.getByText("Today")).toBeVisible();
    await expect(canvas.getAllByRole("listitem")).toHaveLength(5);
    await expect(canvas.queryByRole("link")).not.toBeInTheDocument();

    releaseHeld();

    await expect(
      await canvas.findByRole("link", { name: "Filed chat" }),
    ).toBeVisible();
    await expect(canvas.getAllByRole("listitem")).toHaveLength(1);
    await expect(sentRoutes()).toEqual(RAIL_ROUTES);
  },
};

/**
 * With something pinned, the rail lists the pinned chats under "Pinned",
 * then everything else in its time groups, each from its own server query.
 *
 * @summary the Pinned group above the time groups
 */
export const PinnedAboveTimeGroups: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    responses.set(PINNED_ROUTE, () =>
      jsonResponse([chat("c1", "Pinned chat")]),
    );
    responses.set(ALL_ROUTE, () => jsonResponse([chat("c2", "Unpinned chat")]));
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const pinnedRow = await canvas.findByRole("link", { name: "Pinned chat" });
    const unpinnedRow = await canvas.findByRole("link", {
      name: "Unpinned chat",
    });
    const pinned = canvas.getByText("Pinned");
    const today = canvas.getByText("Today");
    await expect(pinned).toBeVisible();
    await expect(today).toBeVisible();

    // Top to bottom: Pinned, its chat, Today, the other chat.
    await expectTopToBottom([pinned, pinnedRow, today, unpinnedRow]);
    await expect(sentRoutes()).toEqual(RAIL_ROUTES);
  },
};

/**
 * With nothing pinned, the rail has no "Pinned" group, only its time groups.
 *
 * @summary nothing pinned: no Pinned group
 */
export const NothingPinned: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    responses.set(ALL_ROUTE, () => jsonResponse([chat("c1", "Lonely chat")]));
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByRole("link", { name: "Lonely chat" }),
    ).toBeVisible();
    await expect(canvas.getByText("Today")).toBeVisible();
    await expect(canvas.queryByText("Pinned")).not.toBeInTheDocument();
    await expect(sentRoutes()).toEqual(RAIL_ROUTES);
  },
};

/**
 * With no chats at all, pinned or not, the rail says where conversations
 * will appear instead of showing empty groups.
 *
 * @summary no chats: the empty-state note
 */
export const NoChats: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByText(EMPTY_STATE)).toBeVisible();
    await expect(canvas.queryByText("Today")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link")).not.toBeInTheDocument();
    await expect(sentRoutes()).toEqual(RAIL_ROUTES);
  },
};
