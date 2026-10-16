import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { FileUIPart } from "ai";
import type { MediaThumbnailStatus } from "@workspace/ui/components/custom/media-thumbnail";
import { toast } from "@workspace/ui/components/sonner";

import { useChatContext } from "@/contexts/chat-context";
import {
  ATTACHABLE_IMAGE_TYPES,
  ATTACHABLE_PDF_TYPE,
  type MediaDescriptor,
  uploadAttachment,
} from "@/lib/services/media/uploads";
import {
  modelDisplayName,
  useModelsQuery,
} from "@/lib/services/models/queries";
import { safeRandomUUID } from "@/lib/uuid";

/** Attachments one message may carry; the API rejects more. */
export const MAX_COMPOSER_ATTACHMENTS = 10;

/** The kinds the composer attaches, from the model's published `input`. */
type AttachableKind = "image" | "pdf";

/** One attachment on the unsent message, uploaded as soon as it is added. */
export type ComposerAttachment = {
  key: string;
  file: File;
  /** Object URL of `file` for the thumbnail; revoke when dropped. */
  previewUrl: string;
  status: MediaThumbnailStatus;
  /** Set once the upload succeeds. */
  descriptor?: MediaDescriptor;
};

type AttachmentList = ReadonlyArray<ComposerAttachment>;
type UpdateAttachments = (
  change: (current: AttachmentList) => AttachmentList,
) => void;
type UploadAttachment = (key: string, file: File) => void;

interface AttachmentListState {
  items: AttachmentList;
  itemsRef: RefObject<AttachmentList>;
  update: UpdateAttachments;
}

/** The composer's attachment state and actions. */
export interface ComposerAttachments {
  /** Attached images and PDFs in thumbnail (and send) order, which is add
   *  order. */
  items: AttachmentList;
  /** Attaches the files of a kind the selected model declares, up to the cap.
   *  A file of a kind the model does not declare is refused with a toast. */
  add: (files: Iterable<File>) => void;
  remove: (key: string) => void;
  /** Uploads a failed attachment's same file again. */
  retry: (key: string) => void;
  /** Empties the composer for a send, leaving the taken attachments' previews
   *  live until the send settles. */
  clear: () => void;
  /** Puts a failed send's attachments back ahead of any attached while it was
   *  pending, up to the cap; revokes the previews the cap drops. */
  restore: (sent: AttachmentList) => void;
  /** The file picker's `accept`: the kinds the selected model declares. */
  accept: string;
  /** The selected model declares neither image nor pdf input: the picker is
   *  disabled. */
  attachDisabled: boolean;
  /** `<model label> has no <kind> input` while the selected model refuses an
   *  attached kind. */
  blockReason: string | null;
  /** Send must wait: an upload is unfinished or failed, or the selected model
   *  cannot take an attached kind. */
  sendBlocked: boolean;
}

/** Frees the thumbnails' object URLs once their images leave the composer. */
export function revokePreviews(attachments: AttachmentList): void {
  for (const attachment of attachments) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

/** The file parts a send carries, in thumbnail order. */
export function attachmentFileParts(
  attachments: AttachmentList,
): Array<FileUIPart> {
  return attachments.flatMap(({ descriptor }) =>
    descriptor
      ? [
          {
            type: "file" as const,
            mediaType: descriptor.mediaType,
            url: descriptor.locator,
            filename: descriptor.name,
          },
        ]
      : [],
  );
}

/** Which kinds the selected model declares, and its refusal-message label.
 *  Preserve pending-catalog image behavior; PDF input requires a declaration. */
function useModelInputSupport(items: AttachmentList) {
  const { selectedModel } = useChatContext();
  const models = useModelsQuery().data?.models;
  const model = models?.find((candidate) => candidate.id === selectedModel);
  const declared = model?.input ?? [];
  const supported = {
    image: model === undefined || declared.includes("image"),
    pdf: declared.includes("pdf"),
  };
  const label = model ? modelDisplayName(model.id, models) : "Selected model";
  let blockReason: string | null = null;
  for (const { descriptor, file } of items) {
    // The server identifies uploaded bytes; pending files use their MIME type.
    const kind =
      (descriptor?.mediaType ?? file.type) === ATTACHABLE_PDF_TYPE
        ? "pdf"
        : "image";
    if (!supported[kind]) {
      blockReason = `${label} has no ${kind} input`;
      break;
    }
  }
  return { supported, label, blockReason };
}

/** The list with a ref mirror, so adds see the current count synchronously
 *  (two pastes in one tick must not exceed the cap) and async upload
 *  results patch the latest list. */
function useAttachmentList(): AttachmentListState {
  const [items, setItems] = useState<AttachmentList>([]);
  const itemsRef = useRef<AttachmentList>(items);
  const update = useCallback<UpdateAttachments>((change) => {
    itemsRef.current = change(itemsRef.current);
    setItems(itemsRef.current);
  }, []);
  useEffect(() => () => revokePreviews(itemsRef.current), []);
  return { items, itemsRef, update };
}

function useUploader(update: UpdateAttachments): UploadAttachment {
  return useCallback<UploadAttachment>(
    (key, file) => {
      const patch = (change: Partial<ComposerAttachment>) =>
        update((current) =>
          current.map((item) =>
            item.key === key ? { ...item, ...change } : item,
          ),
        );
      patch({ status: "uploading" });
      uploadAttachment(file).then(
        (descriptor) => patch({ status: "ready", descriptor }),
        () => patch({ status: "failed" }),
      );
    },
    [update],
  );
}

function useAttachmentEdits(
  itemsRef: RefObject<AttachmentList>,
  update: UpdateAttachments,
  upload: UploadAttachment,
): Pick<ComposerAttachments, "remove" | "retry" | "restore"> {
  return {
    remove: (key) => {
      revokePreviews(itemsRef.current.filter((item) => item.key === key));
      update((current) => current.filter((item) => item.key !== key));
    },
    retry: (key) => {
      const item = itemsRef.current.find((candidate) => candidate.key === key);
      if (item) upload(key, item.file);
    },
    restore: (sent) => {
      const merged = [...sent, ...itemsRef.current];
      revokePreviews(merged.slice(MAX_COMPOSER_ATTACHMENTS));
      update(() => merged.slice(0, MAX_COMPOSER_ATTACHMENTS));
    },
  };
}

/** Admit browser files by MIME and the selected model's input declarations. */
function attachableFiles(
  files: Iterable<File>,
  supported: Record<AttachableKind, boolean>,
  label: string,
) {
  const accepted: Array<File> = [];
  let refused: AttachableKind | null = null;
  for (const file of files) {
    const kind =
      file.type === ATTACHABLE_PDF_TYPE
        ? "pdf"
        : ATTACHABLE_IMAGE_TYPES.includes(file.type)
          ? "image"
          : null;
    if (kind === null) continue;
    if (supported[kind]) accepted.push(file);
    else refused ??= kind;
  }
  if (refused) toast(`${label} has no ${refused} input`);
  return accepted;
}

/**
 * The composer's attachments: paste, picker, and drop add them (an attachable
 * image type or a PDF, up to {@link MAX_COMPOSER_ATTACHMENTS}), each uploads
 * immediately, and a selected model that does not declare a kind refuses new
 * attachments of it and blocks sending the attached ones.
 */
export function useComposerAttachments(): ComposerAttachments {
  const { items, itemsRef, update } = useAttachmentList();
  const upload = useUploader(update);
  const edits = useAttachmentEdits(itemsRef, update, upload);
  const { supported, label, blockReason } = useModelInputSupport(items);

  const add = (files: Iterable<File>) => {
    const accepted = attachableFiles(files, supported, label);
    if (accepted.length === 0) return;
    const room = MAX_COMPOSER_ATTACHMENTS - itemsRef.current.length;
    const added = accepted.slice(0, Math.max(room, 0)).map((file) => ({
      key: safeRandomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      status: "uploading" as const,
    }));
    update((current) => [...current, ...added]);
    for (const { key, file } of added) upload(key, file);
  };

  return {
    items,
    add,
    ...edits,
    clear: () => update(() => []),
    accept: [
      ...(supported.image ? ATTACHABLE_IMAGE_TYPES : []),
      ...(supported.pdf ? [ATTACHABLE_PDF_TYPE] : []),
    ].join(","),
    attachDisabled: !supported.image && !supported.pdf,
    blockReason,
    sendBlocked:
      blockReason !== null || items.some((item) => item.status !== "ready"),
  };
}
