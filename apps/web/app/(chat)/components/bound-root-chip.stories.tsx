import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { vi } from "vitest";

import type {
  CheckoutResponse,
  MachineResponse,
  ProjectRepositoryLinkWithDefaultsResponse,
  RepositoryResponse,
} from "@/lib/api/generated/models";
import * as machinesQueries from "@/lib/services/machines/queries";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

import { BoundRootChip } from "./bound-root-chip";
import type { BoundRootChat } from "./use-bound-root-location";

// The Machines query is module-mocked in the storybook preview (no SSH-backed
// backend), as in location-chip.stories.tsx; every other read is a real fetch
// against the routed stub, so the chip's own resolution is exercised.
const useMachinesQuery = vi.mocked(machinesQueries.useMachinesQuery, {
  partial: true,
});

const AT = "2026-01-01T00:00:00.000Z";
const PROJECTS_ROUTE = "GET /api/v1/projects";
const LINKS_ROUTE = "GET /api/v1/projects/p1/repositories";
const REPOSITORIES_ROUTE = "GET /api/v1/repositories";
const CHECKOUTS_ROUTE = "GET /api/v1/checkouts";

function project(id: string, name: string) {
  return {
    id,
    ownerUserId: "u1",
    name,
    description: null,
    archivedAt: null,
    defaultExecutorId: null,
    createdAt: AT,
    updatedAt: AT,
  };
}

function link(
  repositoryId: string,
  alias: string,
): ProjectRepositoryLinkWithDefaultsResponse {
  return {
    id: `link-${repositoryId}`,
    ownerUserId: "u1",
    projectId: "p1",
    repositoryId,
    alias,
    isPrimary: true,
    isolation: "inherit",
    createdAt: AT,
    updatedAt: AT,
    defaults: [],
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

let chat: BoundRootChat;
let checkouts: Array<CheckoutResponse>;

function routeOf(input: RequestInfo | URL) {
  const request = input instanceof Request ? input : new Request(input);
  const url = new URL(request.url);
  return `${request.method} ${url.pathname}`;
}

function ChipHarness() {
  return <BoundRootChip chat={chat} />;
}

const meta = {
  component: ChipHarness,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  beforeEach: () => {
    chat = { projectId: "p1", workspaceRoot: "/srv/src/llame" };
    checkouts = [checkout("checkout-1")];
    const fetchMock = stubFetch();
    fetchMock.mockImplementation((input) => {
      switch (routeOf(input)) {
        case PROJECTS_ROUTE:
          return Promise.resolve(jsonResponse([project("p1", "llame")]));
        case LINKS_ROUTE:
          return Promise.resolve(jsonResponse([link("repo-1", "llame")]));
        case REPOSITORIES_ROUTE:
          return Promise.resolve(jsonResponse([repository("repo-1", "llame")]));
        case CHECKOUTS_ROUTE:
          return Promise.resolve(jsonResponse(checkouts));
        default:
          throw new Error(`unrouted fetch in story: ${routeOf(input)}`);
      }
    });
    useMachinesQuery.mockReturnValue({
      data: [machine("nas")],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    return () => {
      vi.unstubAllGlobals();
    };
  },
} satisfies Meta<typeof ChipHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A chat bound to a checkout on a remote Machine: the chip names the project,
 * the repository's alias, the Machine, and the root with its branch.
 *
 * @summary a chat bound to a Machine's main checkout
 */
export const MachineRoot: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByText("llame · llame · nas · /srv/src/llame (master)"),
    ).toBeVisible();
  },
};

/**
 * A chat on a worktree: the chip prints the worktree path, and its second line
 * names the branch and the source checkout's branch.
 *
 * @summary a chat bound to a worktree
 */
export const WorktreeRoot: Story = {
  beforeEach: () => {
    chat = {
      projectId: "p1",
      workspaceRoot: "/srv/src/.llame-worktrees/llame/clear-field-0192",
    };
    checkouts = [
      checkout("checkout-1"),
      checkout("worktree-1", {
        kind: "worktree",
        path: "/srv/src/.llame-worktrees/llame/clear-field-0192",
        parentCheckoutId: "checkout-1",
        branch: "llame/clear-field-0192",
      }),
    ];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByText(
        "llame · llame · nas · /srv/src/.llame-worktrees/llame/clear-field-0192",
      ),
    ).toBeVisible();
    await expect(
      canvas.getByText("llame/clear-field-0192 ← master"),
    ).toBeVisible();
  },
};

/**
 * A filed chat with no bound root: the chip warns instead of guessing, which is
 * the state a create leaves when its Workspace step failed.
 *
 * @summary a filed chat that is not bound to a Workspace
 */
export const UnboundChat: Story = {
  beforeEach: () => {
    chat = { projectId: "p1", workspaceRoot: null };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByText("llame · No Workspace")).toBeVisible();
    await expect(
      canvas.getByText("This chat is not bound to a Workspace."),
    ).toBeVisible();
  },
};

/**
 * A root the owner never registered is still the truth the chat is bound to, so
 * the chip prints it without the catalog's labels and without a warning.
 *
 * @summary a bound root outside the checkout catalog
 */
export const UncataloguedRoot: Story = {
  beforeEach: () => {
    chat = { projectId: "p1", workspaceRoot: "/srv/src/elsewhere" };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByText("llame · /srv/src/elsewhere"),
    ).toBeVisible();
  },
};
