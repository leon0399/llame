import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, mocked, screen, waitFor, within } from "storybook/test";

import { Toaster } from "@workspace/ui/components/sonner";

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

const useModelsQuery = mocked(modelQueries.useModelsQuery, {
  partial: true,
});
const uploadAttachment = mocked(uploads.uploadAttachment);

const TEXT_MODEL_ID = "system:openai:model-one";
const VISION_MODEL_ID = "system:openai:vision-one";
const PDF_MODEL_ID = "system:openai:pdf-one";
const OMNI_MODEL_ID = "system:openai:omni-one";

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
    {
      id: PDF_MODEL_ID,
      source: "system",
      name: "PDF One",
      contextWindowTokens: 128_000,
      input: ["text", "pdf"],
    },
    {
      id: OMNI_MODEL_ID,
      source: "system",
      name: "Omni One",
      contextWindowTokens: 128_000,
      input: ["text", "image", "pdf"],
    },
  ],
} satisfies { defaultModelId: string; models: Array<AvailableModel> };

/** Attachment state for stories that attach nothing. */
const NO_ATTACHMENTS: ComposerAttachments = {
  items: [],
  add: fn(),
  remove: fn(),
  retry: fn(),
  clear: fn(),
  restore: fn(),
  accept: "image/png,image/jpeg,image/gif,image/webp",
  attachDisabled: false,
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

/** A PDF file; the upload is mocked, so its bytes are never parsed. */
function pdfFile(name: string): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

function descriptorFor(file: File): MediaDescriptor {
  return {
    id: "0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a8b",
    locator: "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a8b",
    mediaType: "image/png",
    name: file.name,
    width: 1,
    height: 1,
    byteSize: file.size,
    model: { mediaType: "image/png", width: 1, height: 1, byteSize: file.size },
  };
}

/** The media id every mocked PDF upload resolves under. */
const PDF_MEDIA_ID = "0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7b8b";

function pdfDescriptorFor(file: File): MediaDescriptor {
  return {
    id: PDF_MEDIA_ID,
    locator: `media://${PDF_MEDIA_ID}`,
    mediaType: "application/pdf",
    name: file.name,
    byteSize: file.size,
    pages: 3,
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
          <Toaster />
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

/** Uploads that resolve immediately with a descriptor for the file: an image
 *  descriptor for an image, a PDF descriptor for a PDF. */
function resolveUploads() {
  uploadAttachment.mockImplementation((file: File) =>
    Promise.resolve(
      file.type === "application/pdf"
        ? pdfDescriptorFor(file)
        : descriptorFor(file),
    ),
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
    uploadAttachment.mockImplementation(
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

    const list = await canvas.findByRole("list", { name: "Attachments" });
    await expect(
      within(list).getByRole("img", { name: "shot.png" }),
    ).toBeVisible();
    await expect(uploadAttachment).toHaveBeenCalledWith(file);
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
    uploadAttachment.mockRejectedValueOnce(
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
    await expect(uploadAttachment).toHaveBeenCalledTimes(2);
    await expect(uploadAttachment).toHaveBeenNthCalledWith(2, file);
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

    const list = await canvas.findByRole("list", { name: "Attachments" });
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole("img")
          .map((image) => image.getAttribute("alt")),
      ).toEqual(["picked.png", "dropped.png"]),
    );
    await expect(uploadAttachment).toHaveBeenCalledTimes(2);
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
    const list = await canvas.findByRole("list", { name: "Attachments" });
    await waitFor(() =>
      expect(within(list).getAllByRole("listitem")).toHaveLength(10),
    );

    dropFiles(form!, [pngFile("image-11.png")]);
    // Let any render the drop would have scheduled land before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    await expect(uploadAttachment).toHaveBeenCalledTimes(10);
    await expect(
      canvas.queryByRole("img", { name: "image-11.png" }),
    ).toBeNull();
  },
};

/**
 * With a PDF-declaring model selected, the picker accepts PDFs and a picked,
 * pasted, or dropped PDF attaches: while its upload runs the tile shows the
 * name and no link, and once it succeeds the tile links its stored
 * `/original` in a new tab. No image node renders for a PDF, and the attached
 * PDFs are sendable.
 *
 * @summary a PDF attaches from the picker, paste, and drop
 */
export const PdfAttachesFromPickerPasteAndDrop: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    resolveUploads();
    uploadAttachment.mockImplementationOnce(
      () =>
        new Promise<MediaDescriptor>((resolve) => {
          resolveHeldUpload = resolve;
        }),
    );
  },
  args: {
    onSubmit: fn((event: React.FormEvent<HTMLFormElement>) =>
      event.preventDefault(),
    ),
  },
  render: attachingStory(PDF_MODEL_ID),
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const picker =
      canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
    await expect(picker).toHaveAttribute("accept", "application/pdf");
    await userEvent.upload(picker!, pdfFile("picked.pdf"));

    const list = await canvas.findByRole("list", { name: "Attachments" });
    await expect(within(list).getByText("picked.pdf")).toBeVisible();
    await expect(
      within(list).getByRole("status", { name: "Uploading" }),
    ).toBeInTheDocument();
    await expect(within(list).queryByRole("link")).toBeNull();

    resolveHeldUpload(pdfDescriptorFor(pdfFile("picked.pdf")));
    const link = await within(list).findByRole("link", {
      name: "Open picked.pdf in a new tab",
    });
    await expect(link).toHaveAttribute(
      "href",
      expect.stringMatching(
        new RegExp(`/api/v1/media/${PDF_MEDIA_ID}/original$`),
      ),
    );
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");

    await userEvent.click(canvas.getByPlaceholderText(PLACEHOLDER));
    await userEvent.paste(filesTransfer([pdfFile("pasted.pdf")]));
    const form = canvas.getByPlaceholderText(PLACEHOLDER).closest("form");
    dropFiles(form!, [pdfFile("dropped.pdf")]);

    await waitFor(() =>
      expect(within(list).getAllByRole("listitem")).toHaveLength(3),
    );
    await expect(within(list).queryByRole("img")).toBeNull();
    await expect(uploadAttachment).toHaveBeenCalledTimes(3);
    await expect(screen.queryByRole("dialog")).toBeNull();

    const send = canvas.getByRole("button", { name: "Send message" });
    await waitFor(() => expect(send).toBeEnabled());
    await userEvent.click(send);
    await expect(args.onSubmit).toHaveBeenCalledOnce();
  },
};

/**
 * With a model that declares image but not pdf selected, a pasted PDF is
 * refused with a toast naming the model: no tile and no upload; an image in
 * the same drop still attaches.
 *
 * @summary a model without pdf input refuses PDFs with a toast
 */
export const UnsupportedPdfRefusedByToast: Story = {
  tags: ["ai-generated"],
  beforeEach: resolveUploads,
  render: attachingStory(VISION_MODEL_ID),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByPlaceholderText(PLACEHOLDER));
    await userEvent.paste(filesTransfer([pdfFile("notes.pdf")]));

    const shown = await canvas.findAllByText("Vision One has no pdf input");
    await expect(shown).toHaveLength(1);
    await expect(shown[0]!.closest("[data-sonner-toast]")).not.toBeNull();
    await expect(
      canvas.queryByRole("list", { name: "Attachments" }),
    ).toBeNull();
    await expect(uploadAttachment).not.toHaveBeenCalled();

    const form = canvas.getByPlaceholderText(PLACEHOLDER).closest("form");
    dropFiles(form!, [pdfFile("again.pdf"), pngFile("shot.png")]);
    const list = await canvas.findByRole("list", { name: "Attachments" });
    await waitFor(() =>
      expect(within(list).getAllByRole("listitem")).toHaveLength(1),
    );
    await expect(
      within(list).getByRole("img", { name: "shot.png" }),
    ).toBeVisible();
    await expect(uploadAttachment).toHaveBeenCalledOnce();
  },
};

/**
 * Until the catalog publishes its PDF input, a selected model cannot admit PDFs.
 * @summary a loading catalog cannot grant PDF input
 */
export const UndeclaredModelRefusesPdf: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    resolveUploads();
    useModelsQuery.mockReturnValue({
      data: undefined,
      isError: false,
      isPending: true,
    });
  },
  render: attachingStory(PDF_MODEL_ID),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByPlaceholderText(PLACEHOLDER));
    await userEvent.paste(filesTransfer([pdfFile("notes.pdf")]));
    await waitFor(() =>
      expect(canvas.getByText("Selected model has no pdf input")).toBeVisible(),
    );
    await expect(
      canvas.queryByRole("list", { name: "Attachments" }),
    ).toBeNull();
  },
};

/**
 * With a PDF-only model selected, the picker accepts PDFs only and a pasted
 * image is refused with a toast naming the model, while a pasted PDF attaches.
 *
 * @summary a model without image input refuses images with a toast
 */
export const PdfOnlyModelRefusesImage: Story = {
  tags: ["ai-generated"],
  beforeEach: resolveUploads,
  render: attachingStory(PDF_MODEL_ID),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const picker =
      canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
    await expect(picker).toHaveAttribute("accept", "application/pdf");
    await expect(
      canvas.getByRole("button", { name: "Attach files" }),
    ).toBeEnabled();

    await userEvent.click(canvas.getByPlaceholderText(PLACEHOLDER));
    await userEvent.paste(filesTransfer([pngFile("shot.png")]));

    const shown = await canvas.findAllByText("PDF One has no image input");
    await expect(shown).toHaveLength(1);
    await expect(shown[0]!.closest("[data-sonner-toast]")).not.toBeNull();
    await expect(
      canvas.queryByRole("list", { name: "Attachments" }),
    ).toBeNull();

    await userEvent.paste(filesTransfer([pdfFile("doc.pdf")]));
    const list = await canvas.findByRole("list", { name: "Attachments" });
    await waitFor(() =>
      expect(within(list).getAllByRole("listitem")).toHaveLength(1),
    );
    await expect(uploadAttachment).toHaveBeenCalledOnce();
  },
};

/**
 * Switching from a PDF-declaring model to one without pdf keeps the attached
 * PDF's tile but disables send with an inline reason; switching back enables
 * it again.
 *
 * @summary a model without pdf input blocks sending an attached PDF
 */
export const SwitchingAwayFromPdfBlocksSend: Story = {
  tags: ["ai-generated"],
  // Base UI's portalled model picker leaves aria-hidden focus guards that
  // axe's aria-hidden-focus rule misreads (as in project-item.stories.tsx).
  parameters: {
    a11y: {
      config: { rules: [{ id: "aria-hidden-focus", enabled: false }] },
    },
  },
  beforeEach: resolveUploads,
  render: attachingStory(OMNI_MODEL_ID),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByPlaceholderText(PLACEHOLDER));
    await userEvent.paste(filesTransfer([pdfFile("doc.pdf")]));
    const send = canvas.getByRole("button", { name: "Send message" });
    await waitFor(() => expect(send).toBeEnabled());

    await chooseModel(canvas, userEvent, /Vision One/);
    await expect(
      await canvas.findByText("Vision One has no pdf input"),
    ).toBeVisible();
    await expect(send).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Attach files" }),
    ).toBeEnabled();
    await expect(
      within(canvas.getByRole("list", { name: "Attachments" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(1);

    await chooseModel(canvas, userEvent, /Omni One/);
    await waitFor(() => expect(send).toBeEnabled());
    await expect(canvas.queryByText("Vision One has no pdf input")).toBeNull();
  },
};

/**
 * The 10-attachment cap counts images and PDFs together, in add order: twelve
 * mixed files keep their first ten, alternating image and PDF, and upload
 * exactly those.
 *
 * @summary images and PDFs share the ten-attachment cap
 */
export const MixedAttachmentsShareTheCap: Story = {
  tags: ["ai-generated"],
  beforeEach: resolveUploads,
  render: attachingStory(OMNI_MODEL_ID),
  play: async ({ canvas }) => {
    const form = canvas.getByPlaceholderText(PLACEHOLDER).closest("form");
    dropFiles(
      form!,
      Array.from({ length: 6 }, (_, index) => [
        pngFile(`image-${index * 2 + 1}.png`),
        pdfFile(`doc-${index * 2 + 2}.pdf`),
      ]).flat(),
    );
    const list = await canvas.findByRole("list", { name: "Attachments" });
    await waitFor(() =>
      expect(within(list).getAllByRole("listitem")).toHaveLength(10),
    );

    const order = within(list)
      .getAllByRole("listitem")
      .map(
        (item) =>
          item.querySelector("img")?.getAttribute("alt") ??
          item.querySelector("span")?.textContent,
      );
    await expect(order).toEqual([
      "image-1.png",
      "doc-2.pdf",
      "image-3.png",
      "doc-4.pdf",
      "image-5.png",
      "doc-6.pdf",
      "image-7.png",
      "doc-8.pdf",
      "image-9.png",
      "doc-10.pdf",
    ]);
    await expect(uploadAttachment).toHaveBeenCalledTimes(10);
    await expect(
      canvas.queryByRole("img", { name: "image-11.png" }),
    ).toBeNull();
    await expect(canvas.queryByText("doc-12.pdf")).toBeNull();
  },
};

/**
 * With a text-only model selected, the picker is disabled and a pasted image
 * is refused: no thumbnail, no upload, and a toast names the model that has
 * no image input. Nothing is attached, so no inline reason shows.
 *
 * @summary a text-only model refuses attachments
 */
export const TextOnlyModelRefusesAttach: Story = {
  tags: ["ai-generated"],
  beforeEach: resolveUploads,
  render: attachingStory(TEXT_MODEL_ID),
  play: async ({ canvas, userEvent }) => {
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Attach files" }),
      ).toBeDisabled(),
    );
    await userEvent.click(canvas.getByPlaceholderText(PLACEHOLDER));
    await userEvent.paste(filesTransfer([pngFile("shot.png")]));

    const shown = await canvas.findAllByText("Model One has no image input");
    await expect(shown).toHaveLength(1);
    await expect(shown[0]!.closest("[data-sonner-toast]")).not.toBeNull();
    await expect(
      canvas.queryByRole("list", { name: "Attachments" }),
    ).toBeNull();
    await expect(uploadAttachment).not.toHaveBeenCalled();
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
 * disables send and the picker; switching back to a vision model enables
 * them again.
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
    await expect(
      canvas.getByRole("button", { name: "Attach files" }),
    ).toBeDisabled();
    const list = canvas.getByRole("list", { name: "Attachments" });
    await expect(
      within(list)
        .getAllByRole("img")
        .map((image) => image.getAttribute("alt")),
    ).toEqual(["a.png", "b.png"]);

    await chooseModel(canvas, userEvent, /Vision One/);
    await waitFor(() => expect(send).toBeEnabled());
    await expect(
      canvas.getByRole("button", { name: "Attach files" }),
    ).toBeEnabled();
    await expect(canvas.queryByText("Model One has no image input")).toBeNull();
  },
};

/** Media ids for `a.png` and `b.png`, so each composer image is its own
 *  lightbox slide. */
const A_MEDIA_ID = "0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a01";
const B_MEDIA_ID = "0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a02";

/** `file`'s upload descriptor under its own media id. */
function storedDescriptor(file: File): MediaDescriptor {
  const id = file.name === "a.png" ? A_MEDIA_ID : B_MEDIA_ID;
  return { ...descriptorFor(file), id, locator: `media://${id}` };
}

/**
 * Activating an uploaded thumbnail opens the lightbox over the composer's
 * uploaded images only, on that image's `/original`, captioned from its
 * upload descriptor; a thumbnail still uploading opens nothing, not even
 * once its upload finishes. `Escape` closes it and returns focus to the
 * thumbnail.
 *
 * @summary a composer thumbnail opens a composer-only lightbox
 */
export const ComposerThumbnailOpensLightbox: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    uploadAttachment.mockImplementation((file: File) =>
      file.name === "a.png"
        ? Promise.resolve(storedDescriptor(file))
        : new Promise<MediaDescriptor>((resolve) => {
            resolveHeldUpload = resolve;
          }),
    );
  },
  render: attachingStory(VISION_MODEL_ID),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByPlaceholderText(PLACEHOLDER));
    await userEvent.paste(filesTransfer([pngFile("a.png"), pngFile("b.png")]));
    const list = await canvas.findByRole("list", { name: "Attachments" });
    await userEvent.click(within(list).getByRole("img", { name: "b.png" }));
    await expect(screen.queryByRole("dialog")).toBeNull();

    const send = canvas.getByRole("button", { name: "Send message" });
    resolveHeldUpload(storedDescriptor(pngFile("b.png")));
    await waitFor(() => expect(send).toBeEnabled());
    await expect(screen.queryByRole("dialog")).toBeNull();
    const opener = canvas.getByRole("button", { name: "b.png" });
    await userEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(
      within(dialog).getByRole("img", { name: "b.png" }),
    ).toHaveAttribute(
      "src",
      expect.stringMatching(
        new RegExp(`/api/v1/media/${B_MEDIA_ID}/original$`),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          "1×1 PNG · media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a02",
        ),
      ).toBeVisible(),
    );

    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() =>
      expect(
        screen.getByText(
          "1×1 PNG · media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a01",
        ),
      ).toBeVisible(),
    );

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  },
};

/** A prompt far taller than the composer's `maxHeight`, ending in a short
 *  line so one more character at the end wraps nothing. */
const LONG_PROMPT = [
  ...Array.from({ length: 20 }, (_, index) => `Prompt line ${index + 1}`),
  "tail",
].join("\n");

/** The composer over its own input state, as the chat page wires it, so a
 *  keystroke drives the same controlled re-render. */
function TypingComposer({
  initialInput,
  ...args
}: ComponentProps<typeof ChatComposer> & { initialInput: string }) {
  const [input, setInput] = useState(initialInput);
  return <ChatComposer {...args} input={input} onInputChange={setInput} />;
}

/**
 * A prompt taller than the composer scrolls; typing at its end keeps the
 * textarea where it was scrolled, instead of jumping back to the top.
 *
 * @summary a long prompt keeps its scroll position while typing
 */
export const LongPromptKeepsItsScrollPosition: Story = {
  tags: ["ai-generated"],
  render: (args) => <TypingComposer {...args} initialInput={LONG_PROMPT} />,
  play: async ({ canvasElement, userEvent }) => {
    const textarea =
      within(canvasElement).getByRole<HTMLTextAreaElement>("textbox");
    // The offset only exists once the value overflows the maxHeight clamp.
    await waitFor(() =>
      expect(textarea.scrollHeight).toBeGreaterThan(textarea.clientHeight),
    );

    textarea.scrollTop = textarea.scrollHeight;
    const scrolled = textarea.scrollTop;
    await expect(scrolled).toBeGreaterThan(0);

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    await userEvent.keyboard("x");
    // The hook resizes on the frame after `input`; measuring before that
    // frame reads the pre-resize offset and would assert nothing.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    await expect(textarea).toHaveValue(`${LONG_PROMPT}x`);
    await expect(textarea.scrollTop).toBe(scrolled);
  },
};

/**
 * With an image and a PDF attached, opening the uploaded image shows a
 * lightbox over the composer's images only: the PDF is not a slide, so the
 * single-image dialog offers no previous or next step.
 *
 * @summary a PDF is never an image lightbox slide
 */
export const PdfExcludedFromImageSlides: Story = {
  tags: ["ai-generated"],
  beforeEach: resolveUploads,
  render: attachingStory(OMNI_MODEL_ID),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByPlaceholderText(PLACEHOLDER));
    await userEvent.paste(
      filesTransfer([pngFile("a.png"), pdfFile("doc.pdf")]),
    );
    const list = await canvas.findByRole("list", { name: "Attachments" });
    await waitFor(() =>
      expect(within(list).getAllByRole("listitem")).toHaveLength(2),
    );
    await waitFor(() =>
      expect(within(list).queryAllByRole("status")).toEqual([]),
    );

    await userEvent.click(within(list).getByRole("img", { name: "a.png" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(within(dialog).getAllByRole("img")).toHaveLength(1);
    await expect(
      within(dialog).queryByRole("button", { name: "Next image" }),
    ).toBeNull();
    await expect(
      within(dialog).queryByRole("button", { name: "Previous image" }),
    ).toBeNull();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  },
};
