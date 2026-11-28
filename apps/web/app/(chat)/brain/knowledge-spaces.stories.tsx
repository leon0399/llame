import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import type { KnowledgeSpaceResponse } from "@/lib/api/generated/models";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";
import { KnowledgeSpaces } from "./knowledge-spaces";

const NOTES_ID = "6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e";
const SECOND_ID = "7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e";

let fetchMock: Mock<typeof fetch>;
let spaces: Array<KnowledgeSpaceResponse>;
let failList: boolean;

function space(
  id: string,
  name: string,
  archivedAt: string | null = null,
): KnowledgeSpaceResponse {
  return {
    id,
    name,
    createdAt: "2026-08-23T12:00:00.000Z",
    updatedAt: "2026-08-23T12:00:00.000Z",
    archivedAt,
  };
}

function routeOf(input: RequestInfo | URL) {
  const request = input instanceof Request ? input : new Request(input);
  const url = new URL(request.url);

  return { request, url };
}

function listedSpaces(archived: string | null) {
  return spaces.filter((item) => {
    if (archived === "only") return item.archivedAt !== null;

    if (archived === "with") return true;

    return item.archivedAt === null;
  });
}

async function answerKnowledgeSpaces(input: RequestInfo | URL) {
  const { request, url } = routeOf(input);

  if (request.method === "GET" && url.pathname === "/api/v1/knowledge-spaces") {
    if (failList) return jsonResponse({ message: "nope" }, 500);

    return jsonResponse({
      items: listedSpaces(url.searchParams.get("archived")),
      nextCursor: null,
    });
  }

  if (request.method === "POST") {
    const created = space(NOTES_ID, "Notes");
    spaces = [...spaces, created];

    return jsonResponse(created);
  }

  if (request.method === "PATCH") {
    return patchSpace(url.pathname, await request.text());
  }

  throw new Error(`unrouted fetch in story: ${request.method} ${url.pathname}`);
}

function patchSpace(pathname: string, raw: string) {
  const id = pathname.split("/").at(-1);
  spaces = spaces.map((item) => applyPatch(item, id, raw));
  const updated = spaces.find((item) => item.id === id);

  return jsonResponse(updated ?? {});
}

function applyPatch(
  item: KnowledgeSpaceResponse,
  id: string | undefined,
  raw: string,
): KnowledgeSpaceResponse {
  if (item.id !== id) return item;

  if (raw.includes('"archived":true')) {
    return { ...item, archivedAt: "2026-08-24T00:00:00.000Z" };
  }

  if (raw.includes('"archived":false')) return { ...item, archivedAt: null };

  if (raw.includes("Field notes")) return { ...item, name: "Field notes" };

  return item;
}

const meta = {
  component: KnowledgeSpaces,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  beforeEach: () => {
    spaces = [];
    failList = false;
    fetchMock = stubFetch();
    fetchMock.mockImplementation((input) =>
      Promise.resolve(answerKnowledgeSpaces(input)),
    );

    return () => {
      vi.unstubAllGlobals();
    };
  },
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof KnowledgeSpaces>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The working list shows each Space name and its stable id. Archived Spaces
 * stay off this list.
 *
 * @summary two active Knowledge Spaces
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    spaces = [space(NOTES_ID, "Notes"), space(SECOND_ID, "Notes")];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = await canvas.findByRole("list", { name: "Knowledge Spaces" });

    await expect(within(list).getAllByText("Notes")).toHaveLength(2);
    await expect(within(list).getByText(NOTES_ID)).toBeVisible();
    await expect(within(list).getByText(SECOND_ID)).toBeVisible();
  },
};

/**
 * A new owner has no Spaces. The page says so and offers a way to create one.
 *
 * @summary empty working list
 */
export const Empty: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByText("No Knowledge Spaces yet"),
    ).toBeVisible();
    await expect(
      canvas.getByText(
        "Create a Space to keep notes the assistant can search.",
      ),
    ).toBeVisible();
    await expect(
      canvas.getAllByRole("button", { name: "New Space" }).length,
    ).toBeGreaterThan(0);
  },
};

/**
 * Creating a Space sends the name and shows the new row, id included.
 *
 * @summary create a Knowledge Space from the empty list
 */
export const Create: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByText("No Knowledge Spaces yet");
    const [newSpace] = canvas.getAllByRole("button", { name: "New Space" });

    if (newSpace === undefined) throw new Error("missing New Space");

    await userEvent.click(newSpace);
    await userEvent.type(await screen.findByLabelText("Name"), "Notes");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await expect(
      await canvas.findByRole("list", { name: "Knowledge Spaces" }),
    ).toBeVisible();
    await expect(canvas.getByText("Notes")).toBeVisible();
    await expect(canvas.getByText(NOTES_ID)).toBeVisible();
  },
};

/**
 * Rename sends the new name and replaces the row's label. The id stays.
 *
 * @summary rename a Knowledge Space
 */
export const Rename: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    spaces = [space(NOTES_ID, "Notes")];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(
      await canvas.findByRole("button", { name: "Rename" }),
    );
    const field = await screen.findByLabelText("Name");
    await userEvent.clear(field);
    await userEvent.type(field, "Field notes");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await expect(await canvas.findByText("Field notes")).toBeVisible();
    await expect(canvas.getByText(NOTES_ID)).toBeVisible();
    await expect(canvas.queryByText("Notes")).not.toBeInTheDocument();
  },
};

/**
 * Archive confirms, drops the Space from the working list, and keeps it in
 * the archived view where it can be restored.
 *
 * @summary archive a Knowledge Space and show it in the archived view
 */
export const Archive: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    spaces = [space(NOTES_ID, "Notes")];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(
      await canvas.findByRole("button", { name: "Archive" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Archive" }),
    );

    await expect(
      await canvas.findByText("No Knowledge Spaces yet"),
    ).toBeVisible();

    await userEvent.click(canvas.getByRole("button", { name: "View options" }));
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "Archived" }),
    );

    await expect(await canvas.findByText("Notes")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Unarchive" }),
    ).toBeVisible();
  },
};

/**
 * A second page loads when the owner asks for more. The cursor is opaque.
 *
 * @summary load the next cursor page
 */
export const NextPage: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    fetchMock.mockImplementation((input) => {
      const { url } = routeOf(input);
      const after = url.searchParams.get("after");

      const page =
        after === null
          ? { items: [space(NOTES_ID, "Notes")], nextCursor: "cursor-2" }
          : { items: [space(SECOND_ID, "Second")], nextCursor: null };

      return Promise.resolve(jsonResponse(page));
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByText("Notes");
    await userEvent.click(
      await canvas.findByRole("button", { name: "Load more" }),
    );
    await expect(await canvas.findByText("Second")).toBeVisible();
    await expect(canvas.getByText(NOTES_ID)).toBeVisible();
  },
};

/**
 * A failed list shows an alert and a retry, not an empty collection.
 *
 * @summary the list fails to load
 */
export const LoadFailed: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    failList = true;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByText("Could not load Knowledge Spaces."),
    ).toBeVisible();
    failList = false;
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(canvas.getByText("No Knowledge Spaces yet")).toBeVisible();
    });
  },
};
