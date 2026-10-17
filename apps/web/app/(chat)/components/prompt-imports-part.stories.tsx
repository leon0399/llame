import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, waitFor, within } from "storybook/test";

import {
  Message,
  MessageContent,
} from "@workspace/ui/components/ai-elements/message";
import { TooltipProvider } from "@workspace/ui/components/tooltip";

import { PromptImportsPart } from "./prompt-imports-part";

const meta = {
  component: PromptImportsPart,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Message from="user">
          <MessageContent>
            <Story />
          </MessageContent>
        </Message>
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof PromptImportsPart>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * One prompt whose `@` markers resolved every way: a file imported whole, one
 * cut at the per-file cap, one denied by the `read` permission group, one that
 * failed to read, and a marker skipped past the per-prompt cap. Each state is
 * its own badge; muted states use the visible outline pill with a Ban icon —
 * the model-visible text names denied/failed targets only as not imported and
 * lists omitted locators, while outcome details and resolved paths are owner-only.
 *
 * @summary imported, truncated, denied, failed, and omitted prompt files
 */
export const ImportedDeniedFailedOmitted: Story = {
  tags: ["ai-generated"],
  args: {
    imports: [
      {
        locator: "docs/GUIDE.md",
        resolved: "/home/operator/repo/docs/GUIDE.md",
        outcome: "imported",
      },
      {
        locator: "~/notes/long.md",
        resolved: "/home/operator/notes/long.md",
        outcome: "imported",
        truncated: true,
      },
      { locator: "/srv/secret.md", outcome: "denied" },
      { locator: "missing.md", outcome: "failed" },
    ],
    omitted: ["extra.md"],
  },
  play: async ({ canvas, userEvent }) => {
    const imported = canvas.getByLabelText(
      "Imported prompt file: docs/GUIDE.md",
    );
    const truncated = canvas.getByLabelText(
      "Truncated prompt file: ~/notes/long.md",
    );
    const denied = canvas.getByLabelText("Denied prompt file: /srv/secret.md");
    const failed = canvas.getByLabelText("Failed prompt file: missing.md");
    const omitted = canvas.getByLabelText("Omitted prompt file: extra.md");

    await expect(canvas.getByText("Imports")).toBeVisible();
    await expect(imported).toBeVisible();
    await expect(within(imported).queryByText("imported")).toBeNull();
    await expect(within(truncated).getByText("truncated")).toBeVisible();
    await expect(within(denied).getByText("denied")).toBeVisible();
    await expect(within(failed).getByText("failed")).toBeVisible();
    await expect(within(omitted).getByText("omitted")).toBeVisible();

    // All states use the visible outline pill on a user bubble; muted states
    // convey policy/capacity through the Ban icon and state text.
    await expect(imported).toHaveAttribute("data-variant", "outline");
    await expect(truncated).toHaveAttribute("data-variant", "outline");
    await expect(denied).toHaveAttribute("data-variant", "outline");
    await expect(failed).toHaveAttribute("data-variant", "outline");
    await expect(omitted).toHaveAttribute("data-variant", "outline");

    // The visible badge truncates a long locator; the tooltip carries the
    // locator as written and the path it resolved to.
    await userEvent.hover(truncated);
    const tooltip = await waitFor(() => {
      const content = document.querySelector<HTMLElement>(
        "[data-slot='tooltip-content']",
      );
      expect(content).toBeVisible();
      return content;
    });
    await expect(tooltip).toHaveTextContent(
      "~/notes/long.md → /home/operator/notes/long.md",
    );
  },
};

/** A 160×90 WebP inline thumbnail, the shape the api stores beside an image
 *  it did not keep. */
const SHOT_THUMBNAIL =
  "data:image/webp;base64," +
  "UklGRroBAABXRUJQVlA4IK4BAACwCwCdASqgAFoAPp1Oo0ylpKMiJFIIKLATiWlu" +
  "4XPhcAmeZGHeBdA/irRZMW8YOoOH4GfE+J8T4nxPieeS/C6GBSLPNrj5OMEI06wM" +
  "8/ni5AtxFjTgM6oBdzlxOyfVtk7J2TsnYoAA/v7TCJ1mlIfClbSSyc/b8Tqb6I/O" +
  "zwAZ+60V979foFeaukavTO4rts2Cp1cqIsiUfW+tPc9HKD915iY9d9bZi5Nyv/0v" +
  "9ZPiz01xYjwAaGWKe1GaDSxuUye7+3G06fGMHEaH2hNnS5CtJPYYPR54/oAO+OoP" +
  "vr5bk/KFst/6bx88fT8fzV6JkMExsrlAY/8bwf/z+fZBv+9+sHOB8Knr60MsquP8" +
  "ynZOhQbYcP77WlMZy09sU43YOh0u1wZs/4usJqdtCP06VUVXHsqIHAwHvOYIZN1H" +
  "V96353X9o3FrUNYQ8MVZdZPedV4t2yUc159YwbHyBl7f8FqOtm4iC1P0Kw7pDlvf" +
  "Lz1vCSfOY3RkVsInlOByK3DS6nv7FKFx7r3yZhiP2X8Xbnb8R5DdoeK8rZhIJH0V" +
  "P3n97L90K9SJ7pcAOAAAAAAA";

const MEDIA_LOCATOR = "media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f";

/**
 * A prompt that imported images beside the other outcomes. Every outcome is
 * still listed as a chip, the images as imported prompt files, and each image
 * also shows a thumbnail: an unstored image its inline thumbnail, with no
 * media route, and a `media://` import its `/model` route. An unstored image
 * whose thumbnail exceeded the cap shows only its size, in its entry's place
 * among the thumbnails.
 *
 * @summary image entries with thumbnails beside denied, failed, and omitted prompt files
 */
export const WithImageEntry: Story = {
  tags: ["ai-generated"],
  args: {
    imports: [
      { locator: "docs/GUIDE.md", outcome: "imported" },
      {
        locator: "shot.png",
        resolved: "/home/operator/repo/shot.png",
        outcome: "imported",
        thumbnail: SHOT_THUMBNAIL,
        width: 1600,
        height: 900,
        mediaType: "image/png",
      },
      {
        locator: "poster.png",
        outcome: "imported",
        width: 8000,
        height: 6000,
        mediaType: "image/png",
      },
      { locator: MEDIA_LOCATOR, outcome: "imported", media: MEDIA_LOCATOR },
      { locator: "/srv/secret.png", outcome: "denied" },
      { locator: "missing.png", outcome: "failed" },
    ],
    omitted: ["extra.png"],
  },
  play: async ({ canvas }) => {
    const thumbnails = canvas.getByRole("list", { name: "Imported media" });
    await expect(
      within(thumbnails).getByRole("img", { name: "shot.png" }),
    ).toHaveAttribute("src", SHOT_THUMBNAIL);
    await expect(
      within(thumbnails).getByRole("img", { name: MEDIA_LOCATOR }),
    ).toHaveAttribute(
      "src",
      expect.stringMatching(
        /\/api\/v1\/media\/0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f\/model$/,
      ),
    );
    await expect(within(thumbnails).getAllByRole("img")).toHaveLength(2);
    await expect(canvas.getByText("8000×6000 PNG")).toBeVisible();
    // Thumbnails and the size-only tile keep the entries' order.
    await expect(
      within(thumbnails)
        .getAllByRole("listitem")
        .map((tile) => tile.querySelector("img")?.alt ?? tile.textContent),
    ).toEqual(["shot.png", "8000×6000 PNG", MEDIA_LOCATOR]);

    for (const label of [
      `Imported prompt file: ${MEDIA_LOCATOR}`,
      "Imported prompt file: shot.png",
      "Imported prompt file: poster.png",
      "Imported prompt file: docs/GUIDE.md",
      "Denied prompt file: /srv/secret.png",
      "Failed prompt file: missing.png",
      "Omitted prompt file: extra.png",
    ]) {
      await expect(canvas.getByLabelText(label)).toBeVisible();
    }
  },
};

/**
 * An imported image's thumbnail opens a lightbox over this chip's images
 * only. The unstored image shows its inline thumbnail captioned with the
 * original's size and the locator as written; the arrow keys move past the
 * size-only tile to the stored import, which loads its `/original` route
 * captioned with its `media://` locator. `Escape` returns focus to the
 * thumbnail.
 *
 * @summary an imported image opens the chip's lightbox
 */
export const ImportedImageOpensLightbox: Story = {
  tags: ["ai-generated"],
  args: WithImageEntry.args,
  play: async ({ canvas, userEvent }) => {
    const thumbnails = canvas.getByRole("list", { name: "Imported media" });
    const opener = within(thumbnails).getByRole("button", { name: "shot.png" });
    await userEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(
      within(dialog).getByRole("img", { name: "shot.png" }),
    ).toHaveAttribute("src", SHOT_THUMBNAIL);
    await expect(dialog).toHaveAccessibleDescription("1600×900 PNG · shot.png");

    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(dialog).toHaveAccessibleDescription(MEDIA_LOCATOR),
    );
    await expect(
      within(dialog).getByRole("img", { name: MEDIA_LOCATOR }),
    ).toHaveAttribute(
      "src",
      expect.stringMatching(
        /\/api\/v1\/media\/0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f\/original$/,
      ),
    );

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  },
};

/**
 * A stored PDF import shows a document tile that opens its original in a new
 * tab without requesting an image variant or entering the image lightbox.
 *
 * @summary a stored PDF import opens its original
 */
export const WithPdfEntry: Story = {
  tags: ["ai-generated"],
  args: {
    imports: [
      {
        locator: MEDIA_LOCATOR,
        outcome: "imported",
        kind: "pdf",
        mediaType: "application/pdf",
        pages: 15,
        byteSize: 2_215_244,
        media: MEDIA_LOCATOR,
      },
    ],
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByLabelText(`Imported prompt file: ${MEDIA_LOCATOR}`),
    ).toBeVisible();
    const tile = canvas.getByRole("link", {
      name: `Open ${MEDIA_LOCATOR} in a new tab`,
    });
    await expect(tile.getAttribute("href")).toMatch(
      /\/api\/v1\/media\/0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f\/original$/,
    );
    await expect(tile).toHaveAttribute("target", "_blank");
    await expect(canvas.queryByRole("img")).toBeNull();
  },
};

/**
 * An unstored PDF import keeps its source name but offers no original link.
 * @summary an unstored PDF import is a static document tile
 */
export const WithUnstoredPdfEntry: Story = {
  tags: ["ai-generated"],
  args: {
    imports: [
      {
        locator: "paper.pdf",
        resolved: "/repo/paper.pdf",
        outcome: "imported",
        kind: "pdf",
        mediaType: "application/pdf",
        pages: 15,
        byteSize: 2523,
      },
    ],
  },
  play: async ({ canvas }) => {
    const tiles = canvas.getByRole("list", { name: "Imported media" });
    await expect(within(tiles).getByText("paper.pdf")).toBeVisible();
    await expect(within(tiles).queryByRole("link")).toBeNull();
    await expect(within(tiles).queryByRole("button")).toBeNull();
    await expect(within(tiles).queryByRole("img")).toBeNull();
  },
};
