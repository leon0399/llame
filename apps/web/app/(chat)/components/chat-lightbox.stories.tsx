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
const READ_ID = "0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7b02";
const IMPORT_ID = "0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7b03";

const DESCRIPTORS = {
  [ATTACHMENT_ID]: {
    id: ATTACHMENT_ID,
    locator: `media://${ATTACHMENT_ID}`,
    provenance: "upload",
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
  [READ_ID]: {
    id: READ_ID,
    locator: `media://${READ_ID}`,
    provenance: "read",
    mediaType: "image/png",
    name: "/work/after.png",
    width: 1600,
    height: 900,
    byteSize: 120_000,
    model: {
      mediaType: "image/png",
      width: 1600,
      height: 900,
      byteSize: 120_000,
    },
  },
  [IMPORT_ID]: {
    id: IMPORT_ID,
    locator: `media://${IMPORT_ID}`,
    provenance: "prompt-import",
    mediaType: "image/webp",
    name: "shots/before.webp",
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

/** An owner attachment in the first turn, a `read` image result in the
 *  answer, and a prompt-import image in the next turn: transcript order. */
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
        input: { path: "/work/after.png" },
        output: {
          status: "success",
          kind: "image",
          path: "/work/after.png",
          media: `media://${READ_ID}`,
          mediaType: "image/png",
          width: 1600,
          height: 900,
        },
      },
      { type: "text", text: "The new layout moves the cache in front." },
    ],
  },
  {
    id: "user-import",
    role: "user",
    parts: [
      { type: "text", text: "And against @shots/before.webp?" },
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
                locator: "shots/before.webp",
                resolved: "/work/shots/before.webp",
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

/** Waits until the lightbox, faded in, shows this caption: one variant's
 *  size and format, the provenance, and the locator. */
async function expectCaption(
  size: string,
  provenance: string,
  id: string,
): Promise<void> {
  await waitFor(() =>
    expect(
      screen.getByText(`${size} · ${provenance} · media://${id}`),
    ).toBeVisible(),
  );
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
 * in transcript order: the right arrow crosses into the answer's `read`
 * image and on to the next turn's prompt-import image. The variant toggle
 * switches between the `/model` and `/original` routes, and `Escape`
 * returns focus to the thumbnail.
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
    await expectCaption("2000×1500 PNG", "upload", ATTACHMENT_ID);
    await expect(currentImage().src).toMatch(
      new RegExp(`/api/v1/media/${ATTACHMENT_ID}/model$`),
    );

    await userEvent.keyboard("{ArrowRight}");
    await expectCaption("1600×900 PNG", "read", READ_ID);
    await userEvent.keyboard("{ArrowRight}");
    await expectCaption("800×600 PNG", "prompt-import", IMPORT_ID);
    await userEvent.keyboard("{ArrowLeft}");
    await expectCaption("1600×900 PNG", "read", READ_ID);
    await userEvent.keyboard("{ArrowLeft}");
    await expectCaption("2000×1500 PNG", "upload", ATTACHMENT_ID);

    await userEvent.click(screen.getByRole("button", { name: "Original" }));
    await expectCaption("4000×3000 JPEG", "upload", ATTACHMENT_ID);
    await expect(currentImage().src).toMatch(
      new RegExp(`/api/v1/media/${ATTACHMENT_ID}/original$`),
    );

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  },
};

/**
 * The `read` card's image thumbnail and the prompt-import chip's thumbnail
 * open the same lightbox, each on its own image.
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
    await userEvent.click(
      within(imports).getByRole("button", { name: "shots/before.webp" }),
    );
    await expectCaption("800×600 PNG", "prompt-import", IMPORT_ID);
    await userEvent.keyboard("{ArrowLeft}");
    await expectCaption("1600×900 PNG", "read", READ_ID);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(canvas.getByRole("button", { name: /read/iu }));
    await userEvent.click(
      canvas.getByRole("button", { name: "/work/after.png" }),
    );
    await expectCaption("1600×900 PNG", "read", READ_ID);
    await expect(fetchMediaDescriptor).toHaveBeenCalledTimes(3);
  },
};
