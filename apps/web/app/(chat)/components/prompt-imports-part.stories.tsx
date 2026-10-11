import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, waitFor, within } from "storybook/test";

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
 * also shows a thumbnail that opens the chat lightbox: an unstored image its
 * inline thumbnail, with no media route, and a `media://` import its `/model`
 * route.
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
      { locator: MEDIA_LOCATOR, outcome: "imported", media: MEDIA_LOCATOR },
      { locator: "/srv/secret.png", outcome: "denied" },
      { locator: "missing.png", outcome: "failed" },
    ],
    omitted: ["extra.png"],
    onOpenImage: fn(),
  },
  play: async ({ args, canvas, userEvent }) => {
    const thumbnails = canvas.getByRole("list", { name: "Imported images" });
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
    await userEvent.click(
      within(thumbnails).getByRole("button", { name: "shot.png" }),
    );
    // The unstored image is the payload's second entry.
    await expect(args.onOpenImage).toHaveBeenCalledWith(1);

    await expect(
      canvas.getByLabelText(`Imported prompt file: ${MEDIA_LOCATOR}`),
    ).toBeVisible();
    await expect(
      canvas.getByLabelText("Imported prompt file: shot.png"),
    ).toBeVisible();
    await expect(
      canvas.getByLabelText("Imported prompt file: docs/GUIDE.md"),
    ).toBeVisible();
    await expect(
      canvas.getByLabelText("Denied prompt file: /srv/secret.png"),
    ).toBeVisible();
    await expect(
      canvas.getByLabelText("Failed prompt file: missing.png"),
    ).toBeVisible();
    await expect(
      canvas.getByLabelText("Omitted prompt file: extra.png"),
    ).toBeVisible();
  },
};
