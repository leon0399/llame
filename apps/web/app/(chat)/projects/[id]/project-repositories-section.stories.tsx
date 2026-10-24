import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { ProjectRepositoriesSection } from "./project-repositories-section";
import {
  api,
  clearFieldWorktree,
  link,
  llame,
  localClone,
  routeFetch,
  sentBody,
  sentRoutes,
  website,
} from "./project-repository-story-support";

const LINK_ROUTE = "POST /api/v1/projects/p1/repositories";
const REGISTER_ROUTE = "POST /api/v1/checkouts";

const meta = {
  component: ProjectRepositoriesSection,
  tags: ["autodocs"],
  args: { projectId: "p1" },
  parameters: { layout: "centered" },
  beforeEach: () => {
    api.links = [];
    api.repositories = [llame, website];
    api.checkouts = [];
    api.refusal = null;
    api.registered = localClone;
    return routeFetch();
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

/**
 * A project with no link: one sentence saying what linking is for, and the
 * section's `+` as its only action.
 *
 * @summary no links: the empty sentence and the add action
 */
export const Empty: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByText(/^Link the repositories this project/),
    ).toBeVisible();
    await expect(canvas.queryAllByRole("listitem")).toHaveLength(0);
    await expect(
      canvas.getByRole("button", { name: "Add repository" }),
    ).toBeEnabled();
  },
};

/**
 * Two links, one row each: the project's name for the repository, Primary
 * because there are two to choose from, and a summary of the remote and
 * what the repository holds — or that it has no clone yet.
 *
 * @summary two links: name, Primary badge, and the remote and holdings summary
 */
export const Links: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    api.links = [
      link({ repositoryId: "r1", alias: "llame", isPrimary: true }),
      link({ repositoryId: "r2", alias: "site" }),
    ];
    api.checkouts = [localClone, clearFieldWorktree];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByText(
        "github.com/leon0399/llame · 1 checkout · 1 worktree",
      ),
    ).toBeVisible();
    await expect(canvas.getByText("Primary")).toBeVisible();
    await expect(
      canvas.getByText("git.example.com/acme/website · No checkout"),
    ).toBeVisible();
    await expect(canvas.getAllByRole("listitem")).toHaveLength(2);
  },
};

/**
 * A single link needs no Primary badge: with one repository there is
 * nothing to prefer it over.
 *
 * @summary one link: no Primary badge
 */
export const SingleLink: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    api.links = [link({ repositoryId: "r1", alias: "llame", isPrimary: true })];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByText("llame")).toBeVisible();
    await expect(canvas.queryByText("Primary")).not.toBeInTheDocument();
  },
};

/**
 * The `+` adds a draft row that searches the catalog; a match links in one
 * pick. The project already links a repository, so the new link is not
 * made primary.
 *
 * @summary the draft row links a catalog repository picked from its search
 */
export const AddFromCatalog: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    api.links = [link({ repositoryId: "r1", alias: "llame", isPrimary: true })];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("llame");

    await userEvent.click(
      canvas.getByRole("button", { name: "Add repository" }),
    );
    const field = canvas.getByRole("textbox", { name: "Add repository" });
    await expect(field).toHaveFocus();
    await userEvent.type(field, "web");
    await expect(await canvas.findByText("1 match")).toBeVisible();
    // The linked repository is not offered again.
    await expect(
      canvas.queryByRole("option", { name: /^llame/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("option", { name: /website/ }));

    await waitFor(() => expect(sentRoutes()).toContain(LINK_ROUTE));
    await expect(sentBody(LINK_ROUTE)).resolves.toEqual({
      repositoryId: "r2",
      isPrimary: false,
    });
  },
};

/**
 * A pasted path becomes the draft's one option: Enter registers the clone,
 * then links the repository it resolves to — as the primary, since it is the
 * project's first.
 *
 * @summary a pasted path registers the clone and links its repository
 */
export const AddByPath: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText(/^Link the repositories this project/);

    await userEvent.click(
      canvas.getByRole("button", { name: "Add repository" }),
    );
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Add repository" }),
      "/home/leo/src/llame",
    );
    await expect(canvas.getByText("Enter adds this clone")).toBeVisible();
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(sentRoutes()).toContain(LINK_ROUTE));
    await expect(sentBody(REGISTER_ROUTE)).resolves.toEqual({
      path: "/home/leo/src/llame",
    });
    await expect(sentBody(LINK_ROUTE)).resolves.toEqual({
      repositoryId: "r1",
      isPrimary: true,
    });
  },
};

/**
 * Escape discards the draft without a request, and the section returns to
 * its empty sentence.
 *
 * @summary Escape discards the draft row
 */
export const DraftEscape: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText(/^Link the repositories this project/);

    await userEvent.click(
      canvas.getByRole("button", { name: "Add repository" }),
    );
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Add repository" }),
      "something{Escape}",
    );
    await expect(
      canvas.queryByRole("textbox", { name: "Add repository" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByText(/^Link the repositories this project/),
    ).toBeVisible();
    await expect(sentRoutes()).not.toContain(LINK_ROUTE);
  },
};

/**
 * A row opens its repository's sheet, which holds everything the row leaves
 * out.
 *
 * @summary clicking a row opens the repository sheet
 */
export const OpensSheet: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    api.links = [link({ repositoryId: "r1", alias: "llame" })];
    api.checkouts = [localClone];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByRole("button", { name: /llame/ }));
    const sheet = await screen.findByRole("dialog", { name: "llame" });
    // The sheet slides in; its content is visible once that ends.
    await waitFor(() =>
      expect(
        within(sheet).getByRole("region", { name: /Checkouts/ }),
      ).toBeVisible(),
    );
  },
};
