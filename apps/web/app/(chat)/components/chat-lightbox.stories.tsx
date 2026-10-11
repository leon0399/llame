import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen, waitFor, within } from "storybook/test";
import { vi } from "vitest";
import type { UIMessage } from "ai";

import { messageRenderKey } from "@/lib/services/chat/history";
import * as descriptors from "@/lib/services/media/descriptors";
import type { MediaDescriptor } from "@/lib/services/media/uploads";
import { ChatLightbox } from "./chat-lightbox";
import { ChatMessageRow } from "./chat-message-row";
import { ChatMarkdownProvider } from "./use-chat-markdown-ready";

const fetchMediaDescriptor = vi.mocked(descriptors.fetchMediaDescriptor);

const ATTACHMENT_ID = "0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7b01";
const IMPORT_ID = "0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7b03";

/** A 160×90 WebP inline thumbnail, the shape the api stores beside an image
 *  it did not keep. */
const THUMBNAIL =
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

const DESCRIPTORS = {
  [ATTACHMENT_ID]: {
    id: ATTACHMENT_ID,
    locator: `media://${ATTACHMENT_ID}`,
    mediaType: "image/jpeg",
    name: "diagram.jpg",
    width: 4000,
    height: 3000,
    byteSize: 2_400_000,
    model: {
      mediaType: "image/png",
      width: 2000,
      height: 1500,
      byteSize: 900_000,
    },
  },
  [IMPORT_ID]: {
    id: IMPORT_ID,
    locator: `media://${IMPORT_ID}`,
    mediaType: "image/webp",
    name: "before.webp",
    width: 800,
    height: 600,
    byteSize: 40_000,
    model: {
      mediaType: "image/png",
      width: 800,
      height: 600,
      byteSize: 40_000,
    },
  },
} satisfies Record<string, MediaDescriptor>;

/** An owner attachment in the first turn, an unstored Workspace-relative
 *  `read` image in the answer, and in the next turn an unstored `@shot.png`
 *  import and a stored `@media://` import: transcript order. */
const MESSAGES: Array<UIMessage> = [
  {
    id: "user-attachment",
    role: "user",
    parts: [
      {
        type: "file",
        mediaType: "image/jpeg",
        url: `media://${ATTACHMENT_ID}`,
        filename: "diagram.jpg",
      },
      { type: "text", text: "What changed since this diagram?" },
    ],
  },
  {
    id: "assistant-read",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "call-read-image",
        toolName: "read",
        state: "output-available",
        input: { path: "docs/after.png" },
        output: {
          status: "success",
          kind: "image",
          path: "/work/docs/after.png",
          mediaType: "image/png",
          width: 1600,
          height: 900,
          thumbnail: THUMBNAIL,
        },
      },
      { type: "text", text: "The new layout moves the cache in front." },
    ],
  },
  {
    id: "user-import",
    role: "user",
    parts: [
      {
        type: "text",
        text: `And against @shot.png and @media://${IMPORT_ID}?`,
      },
      {
        type: "data-context",
        data: {
          v: 1,
          producer: "prompt-imports",
          form: "notice",
          runId: "11111111-1111-4111-8111-111111111111",
          payload: {
            imports: [
              {
                locator: "shot.png",
                resolved: "/work/shot.png",
                outcome: "imported",
                thumbnail: THUMBNAIL,
                width: 1280,
                height: 720,
                mediaType: "image/png",
              },
              {
                locator: `media://${IMPORT_ID}`,
                outcome: "imported",
                media: `media://${IMPORT_ID}`,
              },
            ],
          },
          text: '<system-reminder producer="prompt-imports" form="notice">imports</system-reminder>',
        },
      },
    ],
  },
];

/** Waits until the lightbox, faded in, shows this caption: the shown
 *  variant's size and format, and the locator. */
async function expectCaption(caption: string): Promise<void> {
  await waitFor(() => expect(screen.getByText(caption)).toBeVisible());
}

/** Whether the open lightbox offers the original/model variant control. */
function variantControl(): HTMLElement | null {
  return screen.queryByRole("group", { name: "Image variant" });
}

/** The image the lightbox currently shows (neighbours are preloaded inert). */
function currentImage(): HTMLImageElement {
  const image = document.querySelector<HTMLImageElement>(
    ".yarl__slide_current img",
  );
  if (!image) throw new Error("No current lightbox image");
  return image;
}

const meta = {
  component: ChatLightbox,
  tags: ["autodocs"],
  beforeEach: () => {
    fetchMediaDescriptor.mockImplementation((id: string) => {
      const descriptor = Object.values(DESCRIPTORS).find(
        (candidate) => candidate.id === id,
      );
      return descriptor
        ? Promise.resolve(descriptor)
        : Promise.reject(new Error(`GET /api/v1/media/${id} failed (404)`));
    });
  },
  args: { messages: MESSAGES, children: null },
  render: ({ messages }) => (
    <ChatMarkdownProvider>
      <ChatLightbox messages={messages}>
        {messages.map((message) => (
          <ChatMessageRow
            key={messageRenderKey(message)}
            renderKey={messageRenderKey(message)}
            message={message}
            boundary={null}
            modelBoundary={null}
            isLast={false}
            chatId="chat-1"
            status="ready"
            availableModels={[]}
            onForked={fn()}
            onInspectContext={fn()}
          />
        ))}
      </ChatLightbox>
    </ChatMarkdownProvider>
  ),
  parameters: { layout: "padded" },
} satisfies Meta<typeof ChatLightbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Activating an attachment opens the lightbox over every image of the chat
 * in transcript order: the right arrow crosses into the answer's unstored
 * `read` image, captioned with the path the model submitted, and on to the
 * next turn's unstored and stored prompt-import images. The variant toggle
 * switches a stored image between the `/model` and `/original` routes; an
 * unstored image has no toggle. `Escape` returns focus to the thumbnail.
 *
 * @summary any chat thumbnail opens one lightbox over every chat image
 */
export const AcrossMessagesAndToolResults: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    const opener = await waitFor(
      () => canvas.getByRole("button", { name: "diagram.jpg" }),
      { timeout: 15_000 },
    );
    await userEvent.click(opener);
    await expectCaption(`2000×1500 PNG · media://${ATTACHMENT_ID}`);
    await expect(currentImage().src).toMatch(
      new RegExp(`/api/v1/media/${ATTACHMENT_ID}/model$`),
    );

    await userEvent.keyboard("{ArrowRight}");
    await expectCaption("1600×900 PNG · docs/after.png");
    await expect(currentImage()).toHaveAttribute("src", THUMBNAIL);
    await expect(variantControl()).toBeNull();
    await userEvent.keyboard("{ArrowRight}");
    await expectCaption("1280×720 PNG · shot.png");
    await userEvent.keyboard("{ArrowRight}");
    await expectCaption(`800×600 PNG · media://${IMPORT_ID}`);
    await expect(variantControl()).not.toBeNull();
    await userEvent.keyboard("{ArrowLeft}");
    await expectCaption("1280×720 PNG · shot.png");
    await userEvent.keyboard("{ArrowLeft}");
    await expectCaption("1600×900 PNG · docs/after.png");
    await userEvent.keyboard("{ArrowLeft}");
    await expectCaption(`2000×1500 PNG · media://${ATTACHMENT_ID}`);

    await userEvent.click(screen.getByRole("button", { name: "Original" }));
    await expectCaption(`4000×3000 JPEG · media://${ATTACHMENT_ID}`);
    await expect(currentImage().src).toMatch(
      new RegExp(`/api/v1/media/${ATTACHMENT_ID}/original$`),
    );

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  },
};

/**
 * The `read` card and the prompt-import chip render an unstored image from
 * its inline thumbnail and a stored one from its `/model` route; each
 * thumbnail opens the same lightbox on its own image. Only stored images load
 * a descriptor.
 *
 * @summary read results and prompt imports open the chat lightbox
 */
export const FromReadResultAndPromptImport: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    const imports = await waitFor(
      () => canvas.getByRole("list", { name: "Imported images" }),
      { timeout: 15_000 },
    );
    await expect(
      within(imports).getByRole("img", { name: "shot.png" }),
    ).toHaveAttribute("src", THUMBNAIL);
    await expect(
      within(imports)
        .getByRole("img", { name: `media://${IMPORT_ID}` })
        .getAttribute("src"),
    ).toMatch(new RegExp(`/api/v1/media/${IMPORT_ID}/model$`));
    await userEvent.click(
      within(imports).getByRole("button", { name: "shot.png" }),
    );
    await expectCaption("1280×720 PNG · shot.png");
    await userEvent.keyboard("{ArrowLeft}");
    await expectCaption("1600×900 PNG · docs/after.png");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(canvas.getByRole("button", { name: /read/iu }));
    const readThumbnail = canvas.getByRole("img", {
      name: "/work/docs/after.png",
    });
    await expect(readThumbnail).toHaveAttribute("src", THUMBNAIL);
    await userEvent.click(
      canvas.getByRole("button", { name: "/work/docs/after.png" }),
    );
    await expectCaption("1600×900 PNG · docs/after.png");
    await expect(fetchMediaDescriptor).toHaveBeenCalledTimes(2);
  },
};
