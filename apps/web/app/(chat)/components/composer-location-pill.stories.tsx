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
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";

import { ComposerStartRow } from "./composer-start-row";
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
const REGISTER_ROUTE = "POST /api/v1/checkouts";
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
    executorId: "nas",
    path: "machine://nas/srv/src/llame",
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
    facts: null,
    factsCapturedAt: null,
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
    executorId: "nas",
    checkoutId: "checkout-1",
    isolation: "reuse",
    isolationReason: "project_policy",
    isolationChats: 0,
    ...overrides,
  };
}

let fetchMock: Mock<typeof fetch>;
let links: Array<ProjectRepositoryLinkWithDefaultsResponse>;
let checkouts: Array<CheckoutResponse>;
let machines: Array<MachineResponse>;
let previewByQuery = new Map<string, StartLocationResponse>();

// What `POST /api/v1/checkouts` answers: a registered row, or a refusal.
let registered: () => Response;

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

    if (key === REPOSITORIES_ROUTE) {
      return Promise.resolve(jsonResponse([repository("repo-1", "llame")]));
    }

    if (key === CHECKOUTS_ROUTE) {
      return Promise.resolve(jsonResponse(checkouts));
    }

    if (key === REGISTER_ROUTE) return Promise.resolve(registered());

    if (key.startsWith(`GET ${PREVIEW_PATH}`)) {
      const query = key.slice(`GET ${PREVIEW_PATH}`.length).replace("?", "");

      const body =
        previewByQuery.get(query) ??
        namedCheckoutPreview(query) ??
        previewByQuery.get("");

      if (body === undefined) throw new Error(`unrouted preview: ${query}`);

      return Promise.resolve(jsonResponse(body));
    }

    throw new Error(`unrouted fetch in story: ${key}`);
  });
}

/** The server's answer to a named checkout: that checkout, whatever the
 *  project links (the composer's ids are opt-in and decide the location). */
function namedCheckoutPreview(query: string) {
  const named = checkouts.find(
    (row) => row.id === new URLSearchParams(query).get("checkoutId"),
  );

  if (named === undefined) return undefined;

  return preview({
    repositoryId: named.repositoryId,
    executorId: named.executorId,
    checkoutId: named.id,
  });
}

function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => routeOf(input));
}

function setMachines(next: Array<MachineResponse>) {
  machines = next;
  useMachinesQuery.mockReturnValue({
    data: machines,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
}

/** The start row without a project picker: the folder, then the working
 *  directory's own controls, with the typed-folder dialog. */
function PillHarness({ failed = null }: { failed?: WorkspaceFailure | null }) {
  const location = useComposerLocation({ projectId: "p1", failed });

  return <ComposerStartRow project={undefined} location={location} />;
}

const meta = {
  component: PillHarness,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  beforeEach: () => {
    links = [link("repo-1", "llame", { isPrimary: true })];
    checkouts = [checkout("checkout-1")];
    previewByQuery = new Map([["", preview()]]);
    registered = () => jsonResponse({ message: "unrouted" }, 500);
    setMachines([machine("nas")]);
    routeFetch();

    return () => {
      vi.unstubAllGlobals();
    };
  },
} satisfies Meta<typeof PillHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

function cell(canvasElement: HTMLElement, name: RegExp) {
  return within(canvasElement).findByRole("button", { name });
}

/**
 * The project's primary link pre-fills the row from the preview route: the
 * checkout's folder and its mode. A single usable Machine is no choice, so
 * the Machine control is absent. Choosing a folder closes its list.
 *
 * @summary a pre-filled working directory: folder and mode
 */
export const ProjectDefault: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    await expect(await cell(canvasElement, /^Folder, /)).toHaveAccessibleName(
      "Folder, llame",
    );
    await expect(await cell(canvasElement, /^Mode, /)).toHaveAccessibleName(
      "Mode, checkout",
    );
    await expect(
      within(canvasElement).queryByRole("button", { name: /^Machine, / }),
    ).not.toBeInTheDocument();
    await expect(sentRoutes()).toContain(`GET ${PREVIEW_PATH}`);
    await userEvent.click(await cell(canvasElement, /^Folder, /));
    await userEvent.click(
      await screen.findByRole("option", { name: /nas:.*llame/ }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Folder" })).toBeNull();
    });
  },
};

/**
 * The mode control's menu starts the chat in a new worktree and closes, then
 * returns to the checkout and closes again.
 *
 * @summary choosing a worktree and returning to the checkout
 */
export const WorktreeMode: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    await userEvent.click(await cell(canvasElement, /^Mode, /));
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: /^A new worktree/ }),
    );
    await waitFor(async () => {
      await expect(await cell(canvasElement, /^Mode, /)).toHaveAccessibleName(
        "Mode, new worktree",
      );
      await expect(
        screen.queryByRole("menu", { hidden: true }),
      ).not.toBeInTheDocument();
    });

    await userEvent.click(await cell(canvasElement, /^Mode, /));
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: /^The checkout/ }),
    );
    await waitFor(async () => {
      await expect(await cell(canvasElement, /^Mode, /)).toHaveAccessibleName(
        "Mode, checkout",
      );
      await expect(
        screen.queryByRole("menu", { hidden: true }),
      ).not.toBeInTheDocument();
    });
  },
};

/**
 * An offline Machine that holds a checkout of the repository is listed
 * disabled with its reason, so it cannot be chosen.
 *
 * @summary an offline Machine is disabled in the Machine cell
 */
export const OfflineMachine: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    checkouts = [
      checkout("checkout-1"),
      checkout("checkout-2", {
        executorId: "builder",
        path: "machine://builder/srv/src/llame",
      }),
    ];
    setMachines([
      machine("nas"),
      machine("builder", { status: "offline", failureReason: "unreachable" }),
    ]);
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(await cell(canvasElement, /^Machine, /));
    await expect(
      await screen.findByRole("menuitemradio", {
        name: "builder: Offline — Could not be reached",
      }),
    ).toHaveAttribute("aria-disabled", "true");
  },
};

/**
 * A create answered `machine_update_required`: the Machine control appears
 * even with one Machine, names the daemon as unavailable, and its menu
 * disables it with the update sentence as its reason.
 *
 * @summary an outdated daemon: warned on the Machine control and disabled
 */
export const OutdatedDaemon: Story = {
  tags: ["ai-generated"],
  args: {
    failed: {
      status: "machine_update_required",
      executorId: "nas",
      message: "Update the llame-machine daemon on nas.",
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      await cell(
        canvasElement,
        /^Machine, nas, Update the llame-machine daemon/,
      ),
    ).toBeVisible();
    await userEvent.click(await cell(canvasElement, /^Machine, /));
    await expect(
      await screen.findByRole("menuitemradio", {
        name: /^nas: Update the llame-machine daemon on that Machine/,
      }),
    ).toHaveAttribute("aria-disabled", "true");
  },
};

/**
 * The Machine the project default resolves to is offline: the Machine
 * control appears even with one Machine, says it is offline, and its menu
 * opens with the reason.
 *
 * @summary an offline chosen Machine, warned on its own control
 */
export const OfflineChosenMachine: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    setMachines([
      machine("nas", { status: "offline", failureReason: "auth_failed" }),
    ]);
  },
  play: async ({ canvasElement }) => {
    const control = await cell(canvasElement, /^Machine, nas, Offline/);

    await expect(control).toHaveTextContent("nas · offline");
    await userEvent.click(control);

    // The reason heads the menu, and again on the disabled Machine itself.
    // The menu fades in, so it is visible once it settles.
    const [heading] = await screen.findAllByText(
      "Offline — Authentication failed",
    );

    await waitFor(() => expect(heading).toBeVisible());
  },
};

/**
 * "No folder" removes the working directory, overriding the project default:
 * the folder control reads "Folder" again, its mode goes, and the start is
 * unbound.
 *
 * @summary removing the working directory
 */
export const Removed: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    await userEvent.click(await cell(canvasElement, /^Folder, /));
    await userEvent.click(
      await screen.findByRole("option", { name: /^No folder/ }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Folder" })).toBeNull(),
    );
    await waitFor(() =>
      expect(
        within(canvasElement).queryByRole("button", { name: /^Folder, / }),
      ).not.toBeInTheDocument(),
    );
  },
};

/**
 * A project without a repository is an ordinary project: the preview resolves
 * no checkout, and the pill renders nothing and warns about nothing.
 *
 * @summary no working directory, no pill
 */
export const NoWorkingDirectory: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    links = [];
    checkouts = [];
    previewByQuery = new Map([
      ["", preview({ repositoryId: null, executorId: null, checkoutId: null })],
    ]);
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(sentRoutes()).toContain(`GET ${PREVIEW_PATH}`));
    await expect(
      within(canvasElement).queryByRole("button", { name: /^Folder, / }),
    ).not.toBeInTheDocument();
  },
};

/** Opens "Other folder…" from the folder cell, picks the Machine, and types. */
async function typeOtherFolder(
  canvasElement: HTMLElement,
  machineName: string,
  path: string,
) {
  await userEvent.click(await cell(canvasElement, /^Folder, /));
  await userEvent.click(
    await screen.findByRole("option", { name: "Other folder…" }),
  );

  const dialog = await screen.findByRole("dialog", {
    name: "Working directory",
  });

  await userEvent.click(
    within(dialog).getByRole("combobox", { name: "Machine" }),
  );
  await userEvent.click(
    await screen.findByRole("option", { name: machineName }),
  );
  await userEvent.type(within(dialog).getByLabelText("Folder"), path);

  return dialog;
}

/**
 * A typed folder that is already a registered checkout is that checkout: a
 * trailing slash does not matter, and nothing new is registered.
 *
 * @summary "Other folder…" picks the registered checkout at the typed path
 */
export const OtherFolderMatchesCheckout: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    checkouts = [
      checkout("checkout-1"),
      checkout("checkout-2", {
        repositoryId: "repo-2",
        path: "machine://nas/srv/src/notes",
      }),
    ];
  },
  play: async ({ canvasElement }) => {
    const dialog = await typeOtherFolder(
      canvasElement,
      "nas",
      "/srv/src/notes/",
    );

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Use folder" }),
    );
    await waitFor(async () =>
      expect(await cell(canvasElement, /^Folder, /)).toHaveAccessibleName(
        "Folder, notes",
      ),
    );
    await expect(sentRoutes()).not.toContain(REGISTER_ROUTE);
  },
};

/**
 * A folder that is not yet a checkout is registered first, under its
 * `machine://` locator with `#` escaped, and the new checkout is selected.
 *
 * @summary "Other folder…" registers a new checkout
 */
export const OtherFolderRegisters: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    // The server stores the row, so the list the composer refetches holds it.
    registered = () => {
      const row = checkout("checkout-3", {
        repositoryId: "repo-3",
        path: "machine://nas/srv/src/c%23",
      });

      checkouts = [...checkouts, row];

      return jsonResponse(row, 201);
    };
  },
  play: async ({ canvasElement }) => {
    const dialog = await typeOtherFolder(canvasElement, "nas", "/srv/src/c#");
    await userEvent.keyboard("{Enter}");
    await waitFor(async () =>
      expect(await cell(canvasElement, /^Folder, /)).toHaveAccessibleName(
        "Folder, c%23",
      ),
    );
    const index = sentRoutes().indexOf(REGISTER_ROUTE);
    const body = await requestFromCall(fetchMock, index).clone().json();
    await expect(body).toEqual({
      path: "machine://nas/srv/src/c%23",
    });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  },
};

/**
 * The server refuses a folder that is not a git clone: the dialog stays open
 * with the server's sentence, so the reader can correct the path.
 *
 * @summary "Other folder…" shows a refused registration
 */
export const OtherFolderRefused: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    registered = () =>
      jsonResponse({ message: "That folder is not a git clone." }, 422);
  },
  play: async ({ canvasElement }) => {
    const dialog = await typeOtherFolder(canvasElement, "nas", "/tmp/plain");

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Use folder" }),
    );
    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "That folder is not a git clone.",
    );
    await expect(dialog).toBeVisible();
  },
};
