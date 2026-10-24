import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import type {
  CheckoutResponse,
  MachineResponse,
  ProjectRepositoryLinkWithDefaultsResponse,
  RepositoryResponse,
  StartLocationResponse,
} from "@/lib/api/generated/models";
import * as machinesQueries from "@/lib/services/machines/queries";
import type { WorkspaceFailure } from "@/lib/services/project/start-location";
import type { StartLocationPrefill } from "@/lib/services/project/start-location-link";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

import { LocationChip } from "./location-chip";
import { useComposerLocation } from "./use-composer-location";

// The Machines query is module-mocked in the storybook preview (no SSH-backed
// backend); the stories set its result. Every other read is a real fetch
// against the routed stub, so URL construction and cache keys are exercised.
const useMachinesQuery = vi.mocked(machinesQueries.useMachinesQuery, {
  partial: true,
});

const AT = "2026-01-01T00:00:00.000Z";
const LINKS_ROUTE = "GET /api/v1/projects/p1/repositories";
const REPOSITORIES_ROUTE = "GET /api/v1/repositories";
const CHECKOUTS_ROUTE = "GET /api/v1/checkouts";
const PREVIEW_PATH = "/api/v1/projects/p1/start-location";

function link(
  repositoryId: string,
  alias: string,
  overrides: Partial<ProjectRepositoryLinkWithDefaultsResponse> = {},
): ProjectRepositoryLinkWithDefaultsResponse {
  return {
    id: `link-${repositoryId}`,
    ownerUserId: "u1",
    projectId: "p1",
    repositoryId,
    alias,
    isPrimary: false,
    isolation: "inherit",
    createdAt: AT,
    updatedAt: AT,
    defaults: [],
    ...overrides,
  };
}

function repository(id: string, displayName: string): RepositoryResponse {
  return {
    id,
    ownerUserId: "u1",
    displayName,
    canonicalRemote: `git@example.com:leo/${id}.git`,
    createdAt: AT,
    updatedAt: AT,
  };
}

function checkout(
  id: string,
  overrides: Partial<CheckoutResponse> = {},
): CheckoutResponse {
  return {
    id,
    repositoryId: "repo-1",
    executorId: "machine:nas",
    path: "/srv/src/llame",
    kind: "main",
    parentCheckoutId: null,
    branch: "master",
    origin: "registered",
    worktreeBase: null,
    chatIds: [],
    leaseChatId: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function machine(
  name: string,
  overrides: Partial<MachineResponse> = {},
): MachineResponse {
  return {
    name,
    status: "online",
    lastSeenAt: AT,
    failureReason: null,
    hubProtocolVersion: 1,
    daemonProtocolVersion: 1,
    daemonVersion: "0.1.0",
    roots: ["/srv/src"],
    ...overrides,
  };
}

function preview(
  overrides: Partial<StartLocationResponse> = {},
): StartLocationResponse {
  return {
    projectId: "p1",
    repositoryId: "repo-1",
    executorId: "machine:nas",
    checkoutId: "checkout-1",
    isolation: "reuse",
    isolationReason: "project_policy",
    isolationChats: 0,
    ...overrides,
  };
}

let fetchMock: Mock<typeof fetch>;
let links: Array<ProjectRepositoryLinkWithDefaultsResponse>;
let repositories: Array<RepositoryResponse>;
let checkouts: Array<CheckoutResponse>;
let machines: Array<MachineResponse>;
let previewByQuery = new Map<string, StartLocationResponse>();

function routeOf(input: RequestInfo | URL) {
  const request = input instanceof Request ? input : new Request(input);
  const url = new URL(request.url);
  return `${request.method} ${url.pathname}${url.search}`;
}

function routeFetch() {
  fetchMock = stubFetch();
  fetchMock.mockImplementation((input) => {
    const key = routeOf(input);
    if (key === LINKS_ROUTE) return Promise.resolve(jsonResponse(links));
    if (key === REPOSITORIES_ROUTE)
      return Promise.resolve(jsonResponse(repositories));
    if (key === CHECKOUTS_ROUTE)
      return Promise.resolve(jsonResponse(checkouts));
    if (key.startsWith(`GET ${PREVIEW_PATH}`)) {
      const query = key.slice(`GET ${PREVIEW_PATH}`.length).replace("?", "");
      const body = previewByQuery.get(query) ?? previewByQuery.get("");
      if (body === undefined) throw new Error(`unrouted preview: ${query}`);
      return Promise.resolve(jsonResponse(body));
    }
    throw new Error(`unrouted fetch in story: ${key}`);
  });
}

function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => routeOf(input));
}

function ChipHarness({
  failed = null,
  initial = null,
}: {
  failed?: WorkspaceFailure | null;
  initial?: StartLocationPrefill | null;
}) {
  const location = useComposerLocation({
    projectId: "p1",
    projectName: "llame development",
    failed,
    initial,
  });
  return <LocationChip location={location} />;
}

const meta = {
  component: ChipHarness,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  beforeEach: () => {
    links = [link("repo-1", "llame", { isPrimary: true })];
    repositories = [repository("repo-1", "llame")];
    checkouts = [checkout("checkout-1")];
    machines = [machine("nas")];
    previewByQuery = new Map([["", preview()]]);
    useMachinesQuery.mockReturnValue({
      data: machines,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    routeFetch();
    return () => {
      vi.unstubAllGlobals();
    };
  },
} satisfies Meta<typeof ChipHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open the cascade popover, which portals to the document body. */
async function openCascade(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(
    await canvas.findByRole("button", { name: /Chat location/ }),
  );
  return within(await screen.findByRole("dialog", { name: "Chat location" }));
}

/**
 * An entry point's pre-fill (a deep link or "New chat here"): the chip opens on
 * the named repository, Machine, and checkout, and asks for a worktree instead
 * of following the link policy, which the label names as the reader's choice.
 *
 * @summary a chip pre-filled by a deep link, isolating on the named checkout
 */
export const PrefilledFromEntryPoint: Story = {
  args: {
    initial: {
      selection: {
        repositoryId: "repo-1",
        executorId: "machine:nas",
        checkoutId: "checkout-1",
      },
      isolation: "worktree",
    },
  },
  beforeEach: () => {
    previewByQuery = new Map([
      [
        "repositoryId=repo-1&executorId=machine%3Anas&checkoutId=checkout-1",
        preview(),
      ],
    ]);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = await canvas.findByRole("button", { name: /Chat location/ });

    await waitFor(() =>
      expect(chip).toHaveTextContent(
        "llame development · llame · nas · /srv/src/llame",
      ),
    );
    await expect(chip).toHaveTextContent("worktree (your choice)");
    await expect(sentRoutes()).toContain(
      `GET ${PREVIEW_PATH}?repositoryId=repo-1&executorId=machine%3Anas&checkoutId=checkout-1`,
    );
  },
};

/**
 * The common case: the project's primary link resolves to one checkout on an
 * online Machine, so the chip names the root it would bind without a click.
 *
 * @summary a reused bound root: project, repository, Machine, and checkout
 */
export const ReuseBoundRoot: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = await canvas.findByRole("button", { name: /Chat location/ });

    await waitFor(() =>
      expect(chip).toHaveTextContent(
        "llame development · llame · nas · /srv/src/llame (master)",
      ),
    );
    await expect(chip).toHaveTextContent("reuse (project policy)");
    await expect(sentRoutes()).toEqual([
      LINKS_ROUTE,
      REPOSITORIES_ROUTE,
      CHECKOUTS_ROUTE,
      `GET ${PREVIEW_PATH}`,
    ]);
  },
};

/**
 * An `always_worktree` link: the chip shows the source checkout and the branch
 * the create would cut, with the policy that decided it.
 *
 * @summary a worktree start: the branch and base beside the source checkout
 */
export const WorktreeBoundRoot: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    previewByQuery = new Map([
      [
        "",
        preview({
          isolation: "worktree",
          isolationReason: "project_policy",
        }),
      ],
    ]);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = await canvas.findByRole("button", { name: /Chat location/ });

    // The server generates the worktree directory, so the chip names the
    // source checkout and the branch the create will make.
    await waitFor(() =>
      expect(chip).toHaveTextContent(
        "llame development · llame · nas · /srv/src/llame",
      ),
    );
    await expect(chip).toHaveTextContent(
      "new worktree ← master · worktree (project policy)",
    );
  },
};

/**
 * Two links and no primary: the server never picks one silently, so the chip
 * names the level to fix while the send still works (it creates an unbound
 * chat).
 *
 * @summary an unresolvable step: the chip names the repository level
 */
export const UnresolvableStep: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    links = [link("repo-1", "llame"), link("repo-2", "api")];
    repositories = [repository("repo-1", "llame"), repository("repo-2", "api")];
    previewByQuery = new Map([
      ["", preview({ repositoryId: null, executorId: null, checkoutId: null })],
    ]);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = await canvas.findByRole("button", { name: /Chat location/ });

    await waitFor(() =>
      expect(chip).toHaveTextContent("llame development · Choose a repository"),
    );
    await expect(sentRoutes()).toContain(`GET ${PREVIEW_PATH}`);
  },
};

/**
 * The cascade's levels: two repositories, a Machine level with an offline
 * Machine disabled and its reason named, two source checkouts, and the
 * isolation label the preview's reason produced.
 *
 * @summary the cascade: every level, a disabled Machine, and the reason label
 */
export const Cascade: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    links = [
      link("repo-1", "llame", { isPrimary: true }),
      link("repo-2", "api"),
    ];
    repositories = [repository("repo-1", "llame"), repository("repo-2", "api")];
    checkouts = [
      checkout("checkout-1"),
      checkout("checkout-2", { path: "/srv/src/llame-next", branch: "next" }),
      checkout("checkout-3", {
        repositoryId: "repo-2",
        executorId: "machine:builder",
        path: "/srv/src/api",
      }),
      checkout("checkout-4", {
        executorId: "machine:builder",
        path: "/srv/src/llame-builder",
      }),
    ];
    machines = [
      machine("nas"),
      machine("builder", {
        status: "offline",
        failureReason: "unreachable",
      }),
    ];
    // The meta hook captured the previous array, so the new statuses need a
    // fresh result.
    useMachinesQuery.mockReturnValue({
      data: machines,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    previewByQuery = new Map([
      [
        "",
        preview({
          isolation: "worktree",
          isolationReason: "clone_in_use",
          isolationChats: 1,
        }),
      ],
      [
        "repositoryId=repo-2",
        preview({
          repositoryId: "repo-2",
          executorId: "machine:builder",
          checkoutId: "checkout-3",
          isolationReason: "no_link",
        }),
      ],
    ]);
  },
  play: async ({ canvasElement }) => {
    const cascade = await openCascade(canvasElement);

    await expect(cascade.getByText("llame development")).toBeInTheDocument();
    const repositoryLevel = await cascade.findByRole("listbox", {
      name: "Repository",
    });
    await expect(
      within(repositoryLevel).getByRole("option", { name: "llame Primary" }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      await cascade.findByRole("option", {
        name: "builder: Offline — Could not be reached",
      }),
    ).toBeDisabled();
    await expect(
      await cascade.findByRole("listbox", { name: "Source checkout" }),
    ).toBeInTheDocument();
    // Presence, not visibility: the popover's open animation can still be
    // running when the assertion runs.
    await expect(
      cascade.getByText("worktree (clone in use by 1 chat)"),
    ).toBeInTheDocument();
    await expect(cascade.getByLabelText("Base ref")).toBeInTheDocument();
    await expect(cascade.getByLabelText("Name")).toBeInTheDocument();

    // A repository change recomputes the levels below from their defaults:
    // the new preview request carries only the repository id.
    await userEvent.click(
      within(cascade.getByRole("listbox", { name: "Repository" })).getByRole(
        "option",
        { name: "api" },
      ),
    );
    await waitFor(() =>
      expect(sentRoutes()).toContain(`GET ${PREVIEW_PATH}?repositoryId=repo-2`),
    );
    await waitFor(async () =>
      expect(
        await cascade.findByRole("option", { name: /builder: Offline/ }),
      ).toHaveAttribute("aria-selected", "true"),
    );
  },
};

/**
 * A create answered `machine_update_required`: the chip warns, and the cascade
 * disables the daemon that answered, with the update sentence as its reason.
 *
 * @summary an outdated daemon: warned on the chip and disabled in the cascade
 */
export const OutdatedDaemon: Story = {
  tags: ["ai-generated"],
  args: {
    failed: {
      status: "machine_update_required",
      executorId: "machine:nas",
      message: "Update the llame-machine daemon on nas.",
    },
  },
  play: async ({ canvasElement }) => {
    const chip = await within(canvasElement).findByRole("button", {
      name: /Warning: Update the llame-machine daemon on nas/,
    });
    await waitFor(() =>
      expect(chip).toHaveTextContent("Update the llame-machine daemon"),
    );

    const cascade = await openCascade(canvasElement);
    await expect(
      cascade.getByRole("option", {
        name: /nas: Update the llame-machine daemon on that Machine/,
      }),
    ).toBeDisabled();
  },
};

/**
 * One Machine holds a checkout: the level still renders, with a single
 * selected option, and the project is a plain row rather than a one-choice
 * list.
 *
 * @summary a level with a single option
 */
export const SingleOptionLevel: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const cascade = await openCascade(canvasElement);

    const machineLevel = await cascade.findByRole("listbox", {
      name: "Machine",
    });
    await expect(within(machineLevel).getAllByRole("option")).toHaveLength(1);
    await expect(
      within(machineLevel).getByRole("option", { name: /nas/ }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      cascade.queryByRole("listbox", { name: "Repository" }),
    ).not.toBeInTheDocument();
    await expect(
      cascade.queryByRole("listbox", { name: "Source checkout" }),
    ).not.toBeInTheDocument();
  },
};
