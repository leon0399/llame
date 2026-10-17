import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

// Import the pins hooks via the REAL specifier: sb.mock (preview.tsx) redirects
// them to the __mocks__ module, so these are the instances the rows call. The
// stable `pinMutate`/`unpinMutate` controls come from that manual mock and are
// injected into the redirected hooks in `beforeEach`. The real PUT/DELETE and
// the optimistic pins-cache write are covered by pins/mutations.test.tsx.
import * as pinsMutations from "@/lib/services/pins/mutations";
import {
  pinMutate,
  unpinMutate,
} from "@/lib/services/pins/__mocks__/mutations";
import type { ProjectResponse } from "@/lib/services/project/types";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";
import { ProjectListSidebar } from "./index";

const usePinItem = vi.mocked(pinsMutations.usePinItem, { partial: true });
const useUnpinItem = vi.mocked(pinsMutations.useUnpinItem, { partial: true });

// No query hook mocking: the real useProjectsQuery runs both of the rail's
// server-driven lists against a stubbed globalThis.fetch, and usePins reads
// the stubbed pins. A story can hold the lists until it releases them, to
// observe the rail while they load. An unrouted request fails the story.
const PINNED_ROUTE = "GET /api/v1/projects?pinned=only&archived=with";
const UNPINNED_ROUTE = "GET /api/v1/projects?pinned=exclude";
const PINS_ROUTE = "GET /api/v1/pins";
const RAIL_ROUTES = [PINNED_ROUTE, UNPINNED_ROUTE, PINS_ROUTE];
const ARCHIVED_ROUTE = "GET /api/v1/projects?archived=only";
const WITH_ARCHIVED_ROUTE = "GET /api/v1/projects?archived=with";

let fetchMock: Mock<typeof fetch>;
let pinnedProjects: Array<ProjectResponse>;
let archivedProjects: Array<ProjectResponse>;
let unpinnedProjects: Array<ProjectResponse>;
let holdLists: boolean;
let releaseLists: Array<() => void>;

function project(id: string, name: string): ProjectResponse {
  return {
    id,
    ownerUserId: "u1",
    name,
    description: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
  };
}

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

/** A list now, or — while a story holds the lists — once released. */
function answer(body: Array<ProjectResponse>) {
  if (!holdLists) return Promise.resolve(jsonResponse(body));
  return new Promise<Response>((resolve) => {
    releaseLists.push(() => resolve(jsonResponse(body)));
  });
}

function routeFetch() {
  fetchMock = stubFetch();
  fetchMock.mockImplementation((input) => {
    const key = routeOf(input);
    if (key === PINNED_ROUTE) return answer(pinnedProjects);
    if (key === ARCHIVED_ROUTE) return answer(archivedProjects);
    if (key === WITH_ARCHIVED_ROUTE) {
      return answer([...unpinnedProjects, ...archivedProjects]);
    }
    if (key === UNPINNED_ROUTE) return answer(unpinnedProjects);
    if (key === PINS_ROUTE) {
      return Promise.resolve(
        jsonResponse(
          pinnedProjects.map(({ id, name, archivedAt }, position) => ({
            itemType: "project",
            itemId: id,
            position,
            pinnedAt: "2026-01-01T00:00:00.000Z",
            item: { id, name, archivedAt },
          })),
        ),
      );
    }
    throw new Error(`unrouted fetch in story: ${key}`);
  });
}

const meta = {
  component: ProjectListSidebar,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    // The rail shows only alongside the /projects routes.
    nextjs: { appDirectory: true, navigation: { pathname: "/projects" } },
  },
  beforeEach: () => {
    pinnedProjects = [];
    unpinnedProjects = [];
    archivedProjects = [];
    holdLists = false;
    releaseLists = [];
    usePinItem.mockReturnValue({ mutate: pinMutate, isPending: false });
    useUnpinItem.mockReturnValue({ mutate: unpinMutate, isPending: false });
    pinMutate.mockClear();
    unpinMutate.mockClear();
    routeFetch();
    return () => {
      vi.unstubAllGlobals();
    };
  },
  render: () => (
    <SidebarProvider>
      <ProjectListSidebar />
    </SidebarProvider>
  ),
} satisfies Meta<typeof ProjectListSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * With something pinned, the rail lists the pinned projects under "Pinned",
 * then everything else under "All projects", each from its own server query.
 *
 * @summary the Pinned group above the All projects group
 */
export const PinnedAndAllProjects: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    pinnedProjects = [project("p1", "Pinned project")];
    unpinnedProjects = [project("p2", "Plain project")];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const pinnedRow = await canvas.findByRole("link", {
      name: "Pinned project",
    });
    const plainRow = await canvas.findByRole("link", { name: "Plain project" });
    const pinnedLabel = canvas.getByText("Pinned");
    const allLabel = canvas.getByText("All projects");
    await expect(pinnedLabel).toBeVisible();
    await expect(allLabel).toBeVisible();

    // Top to bottom: Pinned, its project, All projects, the other project.
    const tops = [pinnedLabel, pinnedRow, allLabel, plainRow].map(
      (element) => element.getBoundingClientRect().top,
    );
    await expect(tops).toEqual([...tops].sort((a, b) => a - b));
    await expect(new Set(tops).size).toBe(4);

    await expect(sentRoutes()).toEqual(RAIL_ROUTES);
  },
};

/**
 * With nothing pinned, the rail is one unlabelled list: no "Pinned" group and
 * no "All projects" label.
 *
 * @summary nothing pinned: one unlabelled list
 */
export const NothingPinned: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    unpinnedProjects = [project("p1", "Plain project")];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByRole("link", { name: "Plain project" }),
    ).toBeVisible();
    await expect(canvas.queryByText("Pinned")).not.toBeInTheDocument();
    await expect(canvas.queryByText("All projects")).not.toBeInTheDocument();
    await expect(sentRoutes()).toEqual(RAIL_ROUTES);
  },
};

/**
 * While both lists load the rail shows placeholder rows; once they land, an
 * unpinned project's Pin control pins it, handing the pin a card built from
 * the row on screen so the pinned rail can show it before the server answers.
 *
 * @summary Pin on an unpinned project pins it with a card from the row
 */
export const PinAnUnpinnedProject: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    unpinnedProjects = [project("p1", "Acme")];
    holdLists = true;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(sentRoutes()).toEqual(RAIL_ROUTES));
    // That placeholder rows show, not how many: the count is the shared
    // skeleton's default, which the chats rail owns as much as this one.
    await expect(
      canvasElement.querySelectorAll('[data-slot="sidebar-menu-skeleton"]')
        .length,
    ).toBeGreaterThan(0);
    await expect(
      canvas.queryByRole("button", { name: "Pin" }),
    ).not.toBeInTheDocument();

    for (const release of releaseLists) release();

    await userEvent.click(await canvas.findByRole("button", { name: "Pin" }));

    await expect(pinMutate).toHaveBeenCalledTimes(1);
    await expect(pinMutate).toHaveBeenCalledWith({
      itemType: "project",
      itemId: "p1",
      card: { id: "p1", name: "Acme", archivedAt: null },
    });
    await expect(unpinMutate).not.toHaveBeenCalled();
    await expect(sentRoutes()).toEqual(RAIL_ROUTES);
  },
};

/**
 * A pinned project's Unpin control, visible at rest, unpins it.
 *
 * @summary Unpin on a pinned project unpins it
 */
export const UnpinAPinnedProject: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    pinnedProjects = [project("p1", "Acme")];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const unpin = await canvas.findByRole("button", { name: "Unpin" });
    await expect(unpin).toBeVisible();
    await userEvent.click(unpin);

    await expect(unpinMutate).toHaveBeenCalledTimes(1);
    await expect(unpinMutate).toHaveBeenCalledWith({
      itemType: "project",
      itemId: "p1",
    });
    await expect(pinMutate).not.toHaveBeenCalled();
    await expect(sentRoutes()).toEqual(RAIL_ROUTES);
  },
};

function archived(id: string, name: string): ProjectResponse {
  return { ...project(id, name), archivedAt: "2026-01-02T00:00:00.000Z" };
}

/**
 * The view menu's Archived option lists archived projects, with no Pinned
 * section; the chip it raises returns to Active.
 *
 * @summary view menu: Archived, then back to Active through the chip
 */
export const ArchivedView: Story = {
  tags: ["ai-generated"],
  parameters: {
    a11y: { config: { rules: [{ id: "aria-hidden-focus", enabled: false }] } },
  },
  beforeEach: () => {
    pinnedProjects = [project("p1", "Pinned project")];
    unpinnedProjects = [project("p2", "Live project")];
    archivedProjects = [archived("p3", "Old project")];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await canvas.findByRole("link", { name: /Live project/ });

    await userEvent.click(canvas.getByRole("button", { name: "View options" }));
    await userEvent.click(
      await body.findByRole("menuitemradio", { name: "Archived" }),
    );

    await expect(
      await canvas.findByRole("link", { name: /Old project/ }),
    ).toBeVisible();
    await expect(canvas.queryByText("Pinned project")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Live project")).not.toBeInTheDocument();

    await userEvent.click(
      canvas.getByRole("button", { name: "Clear view: Archived" }),
    );
    await expect(
      await canvas.findByRole("link", { name: /Live project/ }),
    ).toBeVisible();
    await expect(canvas.queryByText("Old project")).not.toBeInTheDocument();
  },
};

/**
 * The open project is listed whatever the view: an archived project opened
 * by link joins the Active list, with its Archived badge.
 *
 * @summary the open archived project stays listed in the Active view
 */
export const OpenArchivedProjectStaysListed: Story = {
  tags: ["ai-generated"],
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/projects/p3" } },
    // #232: the Archived pill's tracked low-contrast token defect.
    ...contrastKnownIssue232,
  },
  beforeEach: () => {
    unpinnedProjects = [project("p2", "Live project")];
    archivedProjects = [archived("p3", "Old project")];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const row = await canvas.findByRole("link", { name: /Old project/ });
    await expect(within(row).getByText("Archived")).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: /Live project/ }),
    ).toBeVisible();
  },
};
