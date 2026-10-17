import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import type {
  MediaDescriptorResponse,
  MediaPageResponse,
  MediaPdfDescriptorResponse,
} from "@/lib/api/generated/models";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";
import { MediaGallery } from "./media-gallery";

// No hook mocking: the gallery's infinite query runs for real against a
// stubbed globalThis.fetch, keyed by "METHOD /path?query". An unrouted
// request fails the story.
const FIRST_PAGE_ROUTE = "GET /api/v1/media?limit=48";
const SECOND_PAGE_ROUTE = `GET /api/v1/media?limit=48&before=${mediaId(2)}`;

function mediaId(n: number): string {
  return `0192f3a4-5b6c-7d8e-9f01-${String(n).padStart(12, "0")}`;
}

function image(n: number, name: string): MediaDescriptorResponse {
  return {
    id: mediaId(n),
    locator: `media://${mediaId(n)}`,
    mediaType: "image/png",
    name,
    width: 1200,
    height: 800,
    byteSize: 1000,
    model: { mediaType: "image/png", width: 1200, height: 800, byteSize: 900 },
  };
}

function pdf(n: number, name: string): MediaPdfDescriptorResponse {
  return {
    id: mediaId(n),
    locator: `media://${mediaId(n)}`,
    mediaType: "application/pdf",
    name,
    byteSize: 2000,
    pages: 3,
  };
}

let fetchMock: Mock<typeof fetch>;
let pages: Map<string, () => Response>;

function routeOf(input: RequestInfo | URL) {
  const request = input instanceof Request ? input : new Request(input);
  const url = new URL(request.url);
  return `${request.method} ${url.pathname}${url.search}`;
}

function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => routeOf(input));
}

function page(body: MediaPageResponse): () => Response {
  return () => jsonResponse(body);
}

const meta = {
  component: MediaGallery,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  beforeEach: () => {
    fetchMock = stubFetch();
    fetchMock.mockImplementation((input) => {
      const respond = pages.get(routeOf(input));
      if (respond === undefined) {
        throw new Error(`unrouted fetch in story: ${routeOf(input)}`);
      }
      return Promise.resolve(respond());
    });
    return () => {
      vi.unstubAllGlobals();
    };
  },
  // A fresh client per story, so one story's cached pages never seed another.
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
} satisfies Meta<typeof MediaGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Newest first, each page's `nextCursor` loads the next one once the end of
 * the grid comes into view: images preview their thumbnail and PDFs show the
 * document card, all square.
 *
 * @summary the grid loads the next page as its end comes into view
 */
export const LoadsNextPage: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    pages = new Map([
      [
        FIRST_PAGE_ROUTE,
        page({
          items: [image(3, "lisbon-map.png"), pdf(2, "saved-places.pdf")],
          nextCursor: mediaId(2),
        }),
      ],
      [
        SECOND_PAGE_ROUTE,
        page({ items: [image(1, "sintra.jpg")], nextCursor: null }),
      ],
    ]);
  },
  play: async ({ canvas }) => {
    const grid = await canvas.findByRole("list", { name: "Media" });
    await waitFor(() =>
      expect(within(grid).getAllByRole("listitem")).toHaveLength(3),
    );
    await expect(sentRoutes()).toEqual([FIRST_PAGE_ROUTE, SECOND_PAGE_ROUTE]);
    await expect(
      within(grid).getByRole("link", {
        name: "Open saved-places.pdf in a new tab",
      }),
    ).toHaveAttribute("target", "_blank");

    const [first] = within(grid).getAllByRole("listitem");
    const preview = first!.querySelector("[class*='aspect-square']");
    if (preview === null) throw new Error("card has no square preview");
    const box = preview.getBoundingClientRect();
    await expect(Math.round(box.width)).toBe(Math.round(box.height));
  },
};

/**
 * An image card opens the lightbox on that image's original.
 *
 * @summary an image opens the lightbox
 */
export const ImageOpensLightbox: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    pages = new Map([
      [
        FIRST_PAGE_ROUTE,
        page({ items: [image(1, "lisbon-map.png")], nextCursor: null }),
      ],
    ]);
  },
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "lisbon-map.png" }),
    );
    const dialog = await screen.findByRole("dialog");
    await expect(
      within(dialog).getByRole("img", { name: "lisbon-map.png" }),
    ).toHaveAttribute("src", expect.stringMatching(/\/original$/));
  },
};

/**
 * With nothing stored, the gallery says where media comes from.
 *
 * @summary an empty gallery explains itself
 */
export const Empty: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    pages = new Map([
      [FIRST_PAGE_ROUTE, page({ items: [], nextCursor: null })],
    ]);
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Images and PDFs you attach appear here."),
    ).toBeVisible();
    await expect(canvas.queryByRole("list", { name: "Media" })).toBeNull();
  },
};

/**
 * A failed first page offers a retry that loads the gallery.
 *
 * @summary a failed load retries into the grid
 */
export const LoadFailedRetries: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    let failed = false;
    pages = new Map([
      [
        FIRST_PAGE_ROUTE,
        () => {
          if (!failed) {
            failed = true;
            return new Response(null, { status: 500 });
          }
          return jsonResponse({
            items: [image(1, "lisbon-map.png")],
            nextCursor: null,
          });
        },
      ],
    ]);
  },
  play: async ({ canvas }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Try again" }),
    );
    const grid = await canvas.findByRole("list", { name: "Media" });
    await expect(within(grid).getAllByRole("listitem")).toHaveLength(1);
  },
};

/**
 * A failed next page stops the scroll loading instead of re-requesting it
 * while the end of the grid stays in view, and offers a retry that loads it.
 *
 * @summary a failed next page waits for a retry, then loads
 */
export const NextPageFailedRetries: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    let failed = false;
    pages = new Map([
      [
        FIRST_PAGE_ROUTE,
        page({ items: [image(3, "lisbon-map.png")], nextCursor: mediaId(2) }),
      ],
      [
        SECOND_PAGE_ROUTE,
        () => {
          if (!failed) {
            failed = true;
            return new Response(null, { status: 500 });
          }
          return jsonResponse({
            items: [image(1, "sintra.jpg")],
            nextCursor: null,
          });
        },
      ],
    ]);
  },
  play: async ({ canvas }) => {
    const retry = await canvas.findByRole("button", { name: "Try again" });
    await expect(canvas.getByText("Could not load more media.")).toBeVisible();
    // Settled on the failure: the sentinel is still in view, yet no second
    // request for the failed page goes out on its own.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(
      sentRoutes().filter((route) => route === SECOND_PAGE_ROUTE),
    ).toHaveLength(1);

    await userEvent.click(retry);
    const grid = canvas.getByRole("list", { name: "Media" });
    await waitFor(() =>
      expect(within(grid).getAllByRole("listitem")).toHaveLength(2),
    );
  },
};
