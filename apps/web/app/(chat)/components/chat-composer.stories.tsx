import { type ComponentProps, type ReactNode, useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen, waitFor, within } from "storybook/test";
import { vi } from "vitest";

import { ChatProvider, useChatContext } from "@/contexts/chat-context";
import * as uploads from "@/lib/services/media/uploads";
import type { MediaDescriptor } from "@/lib/services/media/uploads";
import * as modelQueries from "@/lib/services/models/queries";
import type { AvailableModel } from "@/lib/services/models/queries";
import { ChatComposer } from "./chat-composer";
import {
  type ComposerAttachments,
  useComposerAttachments,
} from "./use-composer-attachments";

const useModelsQuery = vi.mocked(modelQueries.useModelsQuery, {
  partial: true,
});
const uploadImage = vi.mocked(uploads.uploadImage);

const TEXT_MODEL_ID = "system:openai:model-one";
const VISION_MODEL_ID = "system:openai:vision-one";

const CATALOG = {
  defaultModelId: TEXT_MODEL_ID,
  models: [
    {
      id: TEXT_MODEL_ID,
      source: "system",
      name: "Model One",
      contextWindowTokens: 128_000,
      input: ["text"],
    },
    {
      id: VISION_MODEL_ID,
      source: "system",
      name: "Vision One",
      contextWindowTokens: 128_000,
      input: ["text", "image"],
    },
  ],
} satisfies { defaultModelId: string; models: Array<AvailableModel> };

/** Attachment state for stories that attach nothing. */
const NO_ATTACHMENTS: ComposerAttachments = {
  items: [],
  add: fn(),
  remove: fn(),
  retry: fn(),
  reorder: fn(),
  clear: fn(),
  restore: fn(),
  blockReason: null,
  sendBlocked: false,
};

/** A 1×1 transparent PNG, so thumbnails decode a real image. */
const PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (char) => char.charCodeAt(0),
);

function pngFile(name: string): File {
  return new File([PNG_BYTES], name, { type: "image/png" });
}

function descriptorFor(file: File): MediaDescriptor {
  return {
    id: "0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a8b",
    locator: "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a8b",
    provenance: "upload",
    mediaType: "image/png",
    name: file.name,
    width: 1,
    height: 1,
    byteSize: file.size,
    model: { mediaType: "image/png", width: 1, height: 1, byteSize: file.size },
  };
}

function filesTransfer(files: ReadonlyArray<File>): DataTransfer {
  const dataTransfer = new DataTransfer();
  for (const file of files) dataTransfer.items.add(file);
  return dataTransfer;
}

/** Drops `files` on `target` with a real DataTransfer. (`fireEvent.drop`
 *  replaces the event's DataTransfer with a copy of its own properties, and
 *  a real one's `files` is a prototype getter, so the copy has none.) */
function dropFiles(target: Element, files: ReadonlyArray<File>): void {
  target.dispatchEvent(
    new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: filesTransfer(files),
    }),
  );
}

/** Selects `modelId` in the chat context, as the page's model
 *  reconciliation would. */
function SelectedModel({
  modelId,
  children,
}: {
  modelId: string;
  children: ReactNode;
}) {
  const { setSelectedModel } = useChatContext();
  useEffect(() => setSelectedModel(modelId), [modelId, setSelectedModel]);
  return children;
}

/** The composer with the real attachment hook over the mocked upload. */
function AttachingComposer(args: ComponentProps<typeof ChatComposer>) {
  const attachments = useComposerAttachments();
  return <ChatComposer {...args} attachments={attachments} />;
}

function attachingStory(modelId: string) {
  return (args: ComponentProps<typeof ChatComposer>) => (
    <SelectedModel modelId={modelId}>
      <AttachingComposer {...args} />
    </SelectedModel>
  );
}

const meta = {
  component: ChatComposer,
  tags: ["autodocs"],
  beforeEach: () => {
    useModelsQuery.mockReturnValue({
      data: CATALOG,
      isError: false,
      isPending: false,
    });
  },
  decorators: [
    (Story) => (
      <ChatProvider>
        <div className="w-full max-w-3xl">
          <Story />
        </div>
      </ChatProvider>
    ),
  ],
  args: {
    chatId: "chat-1",
    input: "",
    onInputChange: fn(),
    onSubmit: fn(),
    onStop: fn(),
    status: "ready",
    modelReadyForSend: true,
    modelSendUnavailableReason: null,
    pendingStop: false,
    attachments: NO_ATTACHMENTS,
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ChatComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Composer control states S1–S4 (design M3): enabled Stop for in-flight
 * turns, disabled spinner only while a held Stop waits for the Run id.
 *
 * @summary Stop enabled in S1–S3; spinner disabled in S4
 */
export const ControlStates: Story = {
  tags: ["ai-generated"],
  render: (args) => (
    <div className="flex flex-col gap-6">
      <div data-testid="s1">
        <p className="mb-2 text-xs text-muted-foreground">S1 submitted</p>
        <ChatComposer {...args} status="submitted" pendingStop={false} />
      </div>
      <div data-testid="s2">
        <p className="mb-2 text-xs text-muted-foreground">
          S2 id known, no output
        </p>
        <ChatComposer {...args} status="streaming" pendingStop={false} />
      </div>
      <div data-testid="s3">
        <p className="mb-2 text-xs text-muted-foreground">S3 streaming</p>
        <ChatComposer {...args} status="streaming" pendingStop={false} />
      </div>
      <div data-testid="s4">
        <p className="mb-2 text-xs text-muted-foreground">S4 pending stop</p>
        <ChatComposer {...args} status="submitted" pendingStop />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    for (const state of ["s1", "s2", "s3"] as const) {
      const region = within(root.getByTestId(state));
      const stop = region.getByRole("button", { name: "Stop generation" });
      await expect(stop).toBeEnabled();
    }
    const s4 = within(root.getByTestId("s4"));
    const stopping = s4.getByRole("button", { name: "Stopping generation" });
    await expect(stopping).toBeDisabled();
  },
};

const PLACEHOLDER = "What would you like to know?";

/** Uploads that resolve immediately with a descriptor for the file. */
function resolveUploads() {
  uploadImage.mockImplementation((file: File) =>
    Promise.resolve(descriptorFor(file)),
  );
}

/** Settles the upload the current story holds open. The web lib targets
 *  pre-ES2024, so this is captured from a Promise executor. */
let resolveHeldUpload: (descriptor: MediaDescriptor) => void = () => {};

/**
 * Pasting a clipboard image with a vision model selected adds a thumbnail
 * and starts its upload at once; send stays disabled until the upload
 * finishes.
 *
 * @summary a pasted image uploads before send and gates it
 */
export const PastedImageUploadsBeforeSend: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    uploadImage.mockImplementation(
      () =>
        new Promise<MediaDescriptor>((resolve) => {
          resolveHeldUpload = resolve;
        }),
    );
  },
  // The page's real handler prevents the native submit; so must this spy,
  // or the frame navigates away.
  args: {
    onSubmit: fn((event: React.FormEvent<HTMLFormElement>) =>
      event.preventDefault(),
    ),
  },
  render: attachingStory(VISION_MODEL_ID),
  play: async ({ args, canvas, userEvent }) => {
    const file = pngFile("shot.png");
    await userEvent.click(canvas.getByPlaceholderText(PLACEHOLDER));
    await userEvent.paste(filesTransfer([file]));

    const list = await canvas.findByRole("list", { name: "Attached images" });
    await expect(
      within(list).getByRole("img", { name: "shot.png" }),
    ).toBeVisible();
    await expect(uploadImage).toHaveBeenCalledWith(file);
    await expect(
      within(list).getByRole("status", { name: "Uploading" }),
    ).toBeInTheDocument();
    const send = canvas.getByRole("button", { name: "Send message" });
    await expect(send).toBeDisabled();

    resolveHeldUpload(descriptorFor(file));
    await waitFor(() => expect(send).toBeEnabled());
    await expect(within(list).queryByRole("status")).toBeNull();
    await userEvent.click(send);
    await expect(args.onSubmit).toHaveBeenCalledOnce();
  },
};

/**
 * A failed upload shows an error overlay and blocks send; retry uploads the
 * same file again.
 *
 * @summary a failed upload blocks send until retried
 */
export const FailedUploadRetries: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    resolveUploads();
    uploadImage.mockRejectedValueOnce(
      new Error("POST /api/v1/media failed (413)"),
    );
  },
  render: attachingStory(VISION_MODEL_ID),
  play: async ({ canvas, userEvent }) => {
    const file = pngFile("large.png");
    await userEvent.click(canvas.getByPlaceholderText(PLACEHOLDER));
    await userEvent.paste(filesTransfer([file]));

    await canvas.findByText("Upload failed");
    const send = canvas.getByRole("button", { name: "Send message" });
    await expect(send).toBeDisabled();

    await userEvent.click(canvas.getByRole("button", { name: "Retry upload" }));
    await expect(uploadImage).toHaveBeenCalledTimes(2);
    await expect(uploadImage).toHaveBeenNthCalledWith(2, file);
    await waitFor(() => expect(send).toBeEnabled());
    await expect(canvas.queryByText("Upload failed")).toBeNull();
  },
};

/**
 * The toolbar's picker and a drop onto the input card both attach images;
 * dropped files of other types are ignored.
 *
 * @summary images attach from the picker and by drop
 */
export const PickerAndDropAttach: Story = {
  tags: ["ai-generated"],
  beforeEach: resolveUploads,
  render: attachingStory(VISION_MODEL_ID),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const picker =
      canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
    await expect(picker).toHaveAttribute(
      "accept",
      "image/png,image/jpeg,image/gif,image/webp",
    );
    await expect(picker).toHaveAttribute("multiple");
    await userEvent.upload(picker!, pngFile("picked.png"));

    const form = canvas.getByPlaceholderText(PLACEHOLDER).closest("form");
    dropFiles(form!, [
      pngFile("dropped.png"),
      new File(["notes"], "notes.txt", { type: "text/plain" }),
    ]);

    const list = await canvas.findByRole("list", { name: "Attached images" });
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole("img")
          .map((image) => image.getAttribute("alt")),
      ).toEqual(["picked.png", "dropped.png"]),
    );
    await expect(uploadImage).toHaveBeenCalledTimes(2);
  },
};

/**
 * The composer holds at most 10 images: an eleventh dropped image is neither
 * added nor uploaded.
 *
 * @summary the eleventh image is ignored
 */
export const EleventhImageIgnored: Story = {
  tags: ["ai-generated"],
  beforeEach: resolveUploads,
  render: attachingStory(VISION_MODEL_ID),
  play: async ({ canvas }) => {
    const form = canvas.getByPlaceholderText(PLACEHOLDER).closest("form");
    const ten = Array.from({ length: 10 }, (_, index) =>
      pngFile(`image-${index + 1}.png`),
    );
    dropFiles(form!, ten);
    const list = await canvas.findByRole("list", { name: "Attached images" });
    await waitFor(() =>
      expect(within(list).getAllByRole("listitem")).toHaveLength(10),
    );

    dropFiles(form!, [pngFile("image-11.png")]);
    // Let any render the drop would have scheduled land before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    await expect(uploadImage).toHaveBeenCalledTimes(10);
    await expect(
      canvas.queryByRole("img", { name: "image-11.png" }),
    ).toBeNull();
  },
};

/**
 * With a text-only model selected, a pasted image is refused: no thumbnail,
 * no upload, and the composer names the model that has no image input. The
 * message goes once another model is selected and stays gone on switching
 * back.
 *
 * @summary a text-only model refuses attachments
 */
export const TextOnlyModelRefusesAttach: Story = {
  tags: ["ai-generated"],
  // Base UI's portalled model picker leaves aria-hidden focus guards that
  // axe's aria-hidden-focus rule misreads (as in project-item.stories.tsx).
  parameters: {
    a11y: {
      config: { rules: [{ id: "aria-hidden-focus", enabled: false }] },
    },
  },
  beforeEach: resolveUploads,
  render: attachingStory(TEXT_MODEL_ID),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByPlaceholderText(PLACEHOLDER));
    await userEvent.paste(filesTransfer([pngFile("shot.png")]));

    await expect(
      await canvas.findByText("Model One has no image input"),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("list", { name: "Attached images" }),
    ).toBeNull();
    await expect(uploadImage).not.toHaveBeenCalled();

    await chooseModel(canvas, userEvent, /Vision One/);
    await waitFor(() =>
      expect(canvas.queryByText("Model One has no image input")).toBeNull(),
    );
    await chooseModel(canvas, userEvent, /Model One/);
    await expect(canvas.queryByText("Model One has no image input")).toBeNull();
  },
};

async function chooseModel(
  canvas: ReturnType<typeof within>,
  userEvent: { click: (element: Element) => Promise<void> },
  name: RegExp,
) {
  await userEvent.click(canvas.getByRole("combobox"));
  // The picker is portalled, so query the document, not the canvas.
  await userEvent.click(await screen.findByRole("option", { name }));
}

/**
 * Switching to a text-only model keeps the attached thumbnails in order but
 * disables send; switching back to a vision model enables it again.
 *
 * @summary a text-only model blocks sending attached images
 */
export const SwitchingToTextOnlyBlocksSend: Story = {
  tags: ["ai-generated"],
  // Base UI's portalled model picker leaves aria-hidden focus guards that
  // axe's aria-hidden-focus rule misreads (as in project-item.stories.tsx).
  parameters: {
    a11y: {
      config: { rules: [{ id: "aria-hidden-focus", enabled: false }] },
    },
  },
  beforeEach: resolveUploads,
  render: attachingStory(VISION_MODEL_ID),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByPlaceholderText(PLACEHOLDER));
    await userEvent.paste(filesTransfer([pngFile("a.png"), pngFile("b.png")]));
    const send = canvas.getByRole("button", { name: "Send message" });
    await waitFor(() => expect(send).toBeEnabled());

    await chooseModel(canvas, userEvent, /Model One/);
    await expect(
      await canvas.findByText("Model One has no image input"),
    ).toBeVisible();
    await expect(send).toBeDisabled();
    const list = canvas.getByRole("list", { name: "Attached images" });
    await expect(
      within(list)
        .getAllByRole("img")
        .map((image) => image.getAttribute("alt")),
    ).toEqual(["a.png", "b.png"]);

    await chooseModel(canvas, userEvent, /Vision One/);
    await waitFor(() => expect(send).toBeEnabled());
    await expect(canvas.queryByText("Model One has no image input")).toBeNull();
  },
};
