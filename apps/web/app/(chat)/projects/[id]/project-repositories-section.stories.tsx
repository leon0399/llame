import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import type { CheckoutResponse } from "@/lib/services/checkouts/queries";
import type { ProjectRepositoryLink } from "@/lib/services/project/types";
import type { RepositoryResponse } from "@/lib/services/repositories/queries";
import {
  emptyResponse,
  jsonResponse,
  stubFetch,
} from "@/lib/test-support/fetch-stub";
import { ProjectRepositoriesSection } from "./project-repositories-section";

// No hook mocking: the real link, catalog, and checkout queries run against a
// stubbed globalThis.fetch, and every write goes through the same seam. An
// unrouted request fails the story, so a play function that sees a request it
// did not route reports it instead of hanging.
const LINKS_ROUTE = "GET /api/v1/projects/p1/repositories";
const REPOSITORIES_ROUTE = "GET /api/v1/repositories";
const CHECKOUTS_ROUTE = "GET /api/v1/checkouts";
const LINK_ROUTE = "POST /api/v1/projects/p1/repositories";
const REGISTER_ROUTE = "POST /api/v1/checkouts";

const AT = "2026-10-24T10:00:00.000Z";

const llame = {
  id: "r1",
  ownerUserId: "u1",
  displayName: "llame",
  canonicalRemote: "github.com/leon0399/llame",
  createdAt: AT,
  updatedAt: AT,
};
const website = {
  id: "r2",
  ownerUserId: "u1",
  displayName: "website",
  canonicalRemote: "gitlab.com/acme/website",
  createdAt: AT,
  updatedAt: AT,
};

function link(
  overrides: Partial<ProjectRepositoryLink> & { repositoryId: string },
): ProjectRepositoryLink {
  return {
    id: `link-${overrides.repositoryId}`,
    ownerUserId: "u1",
    projectId: "p1",
    alias: "llame",
    isPrimary: false,
    isolation: "inherit",
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

const mainCheckout = {
  id: "c1",
  repositoryId: "r1",
  executorId: "machine:nas",
  path: "/home/leo/src/llame",
  kind: "main",
  parentCheckoutId: null,
  branch: "master",
  origin: "registered",
  worktreeBase: null,
  chatIds: [],
  leaseChatId: null,
  createdAt: AT,
  updatedAt: AT,
} satisfies CheckoutResponse;

function worktree(
  overrides: Partial<CheckoutResponse> & { id: string; path: string },
): CheckoutResponse {
  return {
    repositoryId: "r1",
    executorId: "machine:nas",
    kind: "worktree",
    parentCheckoutId: "c1",
    branch: "llame/clear-field-0192",
    origin: "created",
    worktreeBase: null,
    chatIds: [],
    leaseChatId: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

const clearFieldWorktree = worktree({
  id: "c2",
  path: "/home/leo/.llame-worktrees/llame/clear-field-0192",
  branch: "llame/clear-field-0192",
  chatIds: ["chat-1", "chat-2"],
  leaseChatId: "chat-1",
});

const forkWorktree = worktree({
  id: "c3",
  path: "/home/leo/.llame-worktrees/llame/retry-policy",
  branch: "llame/retry-policy",
  chatIds: [],
});

const CHATS = [
  { id: "chat-1", title: "Clear field" },
  { id: "chat-2", title: "Retry policy" },
];

let fetchMock: Mock<typeof fetch>;
let links: Array<ProjectRepositoryLink>;
let repositories: Array<RepositoryResponse>;
let checkouts: Array<CheckoutResponse>;
let removal: { status: number; body: object } | null;

/** "METHOD /path?query" a fetch call targets. */
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
      return Promise.resolve(jsonResponse(repositories));
    }
    if (key === CHECKOUTS_ROUTE)
      return Promise.resolve(jsonResponse(checkouts));
    if (key === LINK_ROUTE) {
      return Promise.resolve(
        jsonResponse(
          link({ repositoryId: "r2", alias: website.displayName }),
          201,
        ),
      );
    }
    if (key === REGISTER_ROUTE) {
      return Promise.resolve(jsonResponse(mainCheckout, 201));
    }
    if (key.startsWith("GET /api/v1/chats/")) {
      const chatId = key.slice("GET /api/v1/chats/".length);
      const chat = CHATS.find((candidate) => candidate.id === chatId);
      if (chat === undefined) {
        throw new Error(`unknown chat in story: ${chatId}`);
      }
      return Promise.resolve(
        jsonResponse({
          id: chat.id,
          ownerUserId: "u1",
          title: chat.title,
          visibility: "private",
          createdAt: AT,
          updatedAt: AT,
          archivedAt: null,
          projectId: "p1",
          workspaceRoot: null,
        }),
      );
    }
    if (key.startsWith("DELETE /api/v1/checkouts/")) {
      if (removal === null) return Promise.resolve(emptyResponse());
      return Promise.resolve(jsonResponse(removal.body, removal.status));
    }
    throw new Error(`unrouted fetch in story: ${key}`);
  });
}

/** "METHOD /path?query" of every request sent so far, in order. */
function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => routeOf(input));
}

const meta = {
  component: ProjectRepositoriesSection,
  tags: ["autodocs"],
  args: { projectId: "p1" },
  parameters: { layout: "centered" },
  beforeEach: () => {
    links = [];
    repositories = [llame, website];
    checkouts = [];
    removal = null;
    routeFetch();
    return () => {
      vi.unstubAllGlobals();
    };
  },
  // The section lives in the project page's side panel column.
  render: () => (
    <div className="w-80 rounded-lg border">
      <ProjectRepositoriesSection projectId="p1" />
    </div>
  ),
} satisfies Meta<typeof ProjectRepositoriesSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens the section's + menu and returns the named item. */
async function addMenuItem(
  canvas: ReturnType<typeof within>,
  name: "Link repository" | "Register checkout",
) {
  await userEvent.click(canvas.getByRole("button", { name: "Add repository" }));
  return screen.findByRole("menuitem", { name });
}

/**
 * A project with no link and no worktree: what linking is for, the two
 * writes the + menu offers, and no empty structure pretending to be data.
 *
 * @summary no links: the empty state and the two dialogs' entry points
 */
export const Empty: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByText(/No repository is linked yet\./),
    ).toBeVisible();
    await expect(
      canvas.getByText(/No worktree is recorded for this project\./),
    ).toBeVisible();
    await expect(canvas.queryAllByRole("listitem")).toHaveLength(0);
    const link = await addMenuItem(canvas, "Link repository");
    await waitFor(() => expect(link).not.toHaveAttribute("data-disabled"));
    await expect(
      screen.getByRole("menuitem", { name: "Register checkout" }),
    ).toBeVisible();
  },
};

/**
 * Two links: the primary one shows its badge and its always-worktree policy,
 * the other inherits, and each row carries the catalog remote that decides
 * which clones belong to it. Each row's Edit and Unlink sit behind its menu.
 *
 * @summary two links: alias, primary badge, isolation policy, and remote
 */
export const Links: Story = {
  tags: ["ai-generated"],
  // The unlink confirmation's destructive Button tint (#232), not this section.
  parameters: { ...contrastKnownIssue232 },
  beforeEach: () => {
    links = [
      link({
        repositoryId: "r1",
        alias: "llame",
        isPrimary: true,
        isolation: "always_worktree",
      }),
      link({ repositoryId: "r2", alias: "site", isolation: "inherit" }),
    ];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = await canvas.findByRole("list");

    await expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    await expect(canvas.getByText("llame")).toBeVisible();
    await expect(canvas.getByText("Primary")).toBeVisible();
    await expect(canvas.getByText("Always start a worktree")).toBeVisible();
    await expect(canvas.getByText("Reuse the checkout")).toBeVisible();
    await expect(canvas.getByText("github.com/leon0399/llame")).toBeVisible();
    await expect(canvas.getByText("gitlab.com/acme/website")).toBeVisible();

    await userEvent.click(
      canvas.getByRole("button", { name: "Actions for site" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Unlink" }),
    );
    const confirm = await screen.findByRole("alertdialog");
    // The dialog fades in over 100ms; it is visible once that ends.
    await waitFor(() => expect(confirm).toBeVisible());
  },
};

/**
 * The project's worktrees: path, branch, the chat whose lease records each
 * one, and every chat bound to it — two ids would say nothing, so each
 * resolves to a title. Remove asks first.
 *
 * @summary worktrees: paths, the creating chat, the bound chats, guarded Remove
 */
export const Worktrees: Story = {
  tags: ["ai-generated"],
  // The confirm action's destructive Button tint (#232), not this section.
  parameters: { ...contrastKnownIssue232 },
  beforeEach: () => {
    links = [link({ repositoryId: "r1", isPrimary: true })];
    checkouts = [mainCheckout, clearFieldWorktree, forkWorktree];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const worktrees = await canvas.findByRole("region", { name: "Worktrees" });

    await expect(
      within(worktrees).getByText(
        "/home/leo/.llame-worktrees/llame/clear-field-0192",
      ),
    ).toBeVisible();
    // Each id resolves to its title through the owner chat read. The lease
    // holder is also the first bound chat, so that title appears twice.
    await expect(
      await within(worktrees).findAllByText("Clear field"),
    ).toHaveLength(2);
    await expect(
      await within(worktrees).findByText("Retry policy"),
    ).toBeVisible();
    await expect(within(worktrees).getByText("No chat recorded")).toBeVisible();
    // The main checkout is not a worktree, so it is not listed.
    await expect(
      within(worktrees).queryByText("/home/leo/src/llame"),
    ).not.toBeInTheDocument();

    await userEvent.click(
      within(worktrees).getByRole("button", {
        name: "Remove /home/leo/.llame-worktrees/llame/clear-field-0192",
      }),
    );
    const confirm = await screen.findByRole("alertdialog");
    // The dialog fades in over 100ms; its content is visible once that ends.
    await waitFor(() =>
      expect(
        within(confirm).getByText(/is removed and its row forgotten/),
      ).toBeVisible(),
    );
  },
};

/**
 * The guarded refusal: the route answers 409 with its own sentence, and that
 * sentence — not a generic failure — appears beside the worktree, which stays.
 *
 * @summary a refused removal shows the server's refusal and keeps the row
 */
export const RemoveRefused: Story = {
  tags: ["ai-generated"],
  // The confirm action's destructive Button tint (#232), not this section.
  parameters: { ...contrastKnownIssue232 },
  beforeEach: () => {
    links = [link({ repositoryId: "r1", isPrimary: true })];
    checkouts = [mainCheckout, clearFieldWorktree];
    removal = {
      status: 409,
      body: {
        statusCode: 409,
        error: "Conflict",
        code: "worktree_not_clean",
        message: "The worktree holds uncommitted changes.",
      },
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const worktrees = await canvas.findByRole("region", { name: "Worktrees" });

    await userEvent.click(
      within(worktrees).getByRole("button", {
        name: "Remove /home/leo/.llame-worktrees/llame/clear-field-0192",
      }),
    );
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Remove" }),
    );

    await expect(
      await within(worktrees).findByText(
        "The worktree holds uncommitted changes.",
      ),
    ).toBeVisible();
    await expect(
      within(worktrees).getByText(
        "/home/leo/.llame-worktrees/llame/clear-field-0192",
      ),
    ).toBeVisible();
    await waitFor(() =>
      expect(sentRoutes()).toContain("DELETE /api/v1/checkouts/c2/worktree"),
    );
  },
};

/**
 * Registering a checkout: one path, an optional repository selector, and the
 * note that the executor follows from the path. The write carries the path the
 * owner typed and nothing else when no selector is chosen.
 *
 * @summary the registration form posts the path, with the selectors omitted
 */
export const RegisterCheckout: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await addMenuItem(canvas, "Register checkout"));
    const dialog = await screen.findByRole("dialog", {
      name: "Register checkout",
    });
    await waitFor(() =>
      expect(
        within(dialog).getByText(/The executor follows from the path/),
      ).toBeVisible(),
    );
    await userEvent.type(
      within(dialog).getByLabelText("Path"),
      "machine://nas/home/leo/src/llame",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Register" }),
    );

    await waitFor(() =>
      expect(sentRoutes()).toContain("POST /api/v1/checkouts"),
    );
    const request = fetchMock.mock.calls
      .map(([input]) => (input instanceof Request ? input : new Request(input)))
      .find((candidate) => candidate.method === "POST");
    if (request === undefined) throw new Error("no registration request");
    // JSON.stringify drops the undefined selectors: the body is the path alone.
    await expect(request.clone().json()).resolves.toEqual({
      path: "machine://nas/home/leo/src/llame",
    });
  },
};

/**
 * Linking a repository: the picker offers the catalog minus what is already
 * linked, the policy picker starts at the link default, and the POST carries
 * the chosen repository, alias, primary flag, and isolation.
 *
 * @summary the link dialog posts the chosen repository and its settings
 */
export const LinkRepository: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    links = [link({ repositoryId: "r1", alias: "llame", isPrimary: true })];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The item waits for the link read: a pending one is disabled.
    const linkItem = await addMenuItem(canvas, "Link repository");
    await waitFor(() => expect(linkItem).not.toHaveAttribute("data-disabled"));
    await userEvent.click(linkItem);
    const dialog = await screen.findByRole("dialog", {
      name: "Link repository",
    });
    const picker = within(
      within(dialog).getByRole("listbox", { name: "Repository" }),
    );
    // The linked repository is not offered again.
    await expect(
      picker.queryByRole("option", { name: /llame/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(picker.getByRole("option", { name: /website/ }));

    await userEvent.type(within(dialog).getByLabelText("Alias"), "site");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Always start a worktree/ }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Link" }));

    await waitFor(() => expect(sentRoutes()).toContain(LINK_ROUTE));
    const request = fetchMock.mock.calls
      .map(([input]) => (input instanceof Request ? input : new Request(input)))
      .find((candidate) => candidate.method === "POST");
    if (request === undefined) throw new Error("no link request");
    await expect(request.clone().json()).resolves.toEqual({
      repositoryId: "r2",
      alias: "site",
      isPrimary: false,
      isolation: "always_worktree",
    });
  },
};
