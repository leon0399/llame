import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { FileUIPart } from "ai";
import type { ImageThumbnailStatus } from "@workspace/ui/components/custom/image-thumbnail";

import { useChatContext } from "@/contexts/chat-context";
import {
  ATTACHABLE_IMAGE_TYPES,
  type MediaDescriptor,
  uploadImage,
} from "@/lib/services/media/uploads";
import {
  modelDisplayName,
  useModelsQuery,
} from "@/lib/services/models/queries";
import { safeRandomUUID } from "@/lib/uuid";

/** Images one message may carry; the API rejects more. */
export const MAX_COMPOSER_ATTACHMENTS = 10;

/** One image attached to the unsent message, uploaded as soon as it is added. */
export type ComposerAttachment = {
  key: string;
  file: File;
  /** Object URL of `file` for the thumbnail; revoke when dropped. */
  previewUrl: string;
  status: ImageThumbnailStatus;
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
  /** Attached images in thumbnail (and send) order. */
  items: AttachmentList;
  /** Attaches the files of an attachable image type, up to the cap. */
  add: (files: Iterable<File>) => void;
  remove: (key: string) => void;
  /** Uploads a failed image's same file again. */
  retry: (key: string) => void;
  reorder: (from: number, to: number) => void;
  /** Swaps the whole list: the submit path takes the images for a send and
   *  puts them back when it fails. Clears a refused-attach message. */
  replace: (next: AttachmentList) => void;
  /** `<model label> has no image input` while the selected model refuses
   *  images and some are attached, or an attach was refused under the
   *  current selection since the last send. */
  blockReason: string | null;
  /** Send must wait: an upload is unfinished or failed, or the selected
   *  model cannot take the attached images. */
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

/** Whether the selected model publishes no `image` input, and its label for
 *  the block message (`name`, else `id`). Unknown models block nothing: send
 *  is already gated on an available model. */
function useImageInputSupport() {
  const { selectedModel } = useChatContext();
  const models = useModelsQuery().data?.models;
  const model = models?.find((candidate) => candidate.id === selectedModel);
  return {
    selectedModel,
    imageInputMissing: model !== undefined && !model.input.includes("image"),
    label: model ? modelDisplayName(model.id, models) : "",
  };
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
      uploadImage(file).then(
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
): Pick<ComposerAttachments, "remove" | "retry" | "reorder" | "replace"> {
  return {
    remove: (key) => {
      revokePreviews(itemsRef.current.filter((item) => item.key === key));
      update((current) => current.filter((item) => item.key !== key));
    },
    retry: (key) => {
      const item = itemsRef.current.find((candidate) => candidate.key === key);
      if (item) upload(key, item.file);
    },
    reorder: (from, to) =>
      update((current) => {
        const next = [...current];
        const [moved] = next.splice(from, 1);
        if (moved) next.splice(to, 0, moved);
        return next;
      }),
    replace: (next) => update(() => next),
  };
}

/** Whether an attach was refused under `selectedModel`. Selecting another
 *  model drops the refusal, so switching back does not bring the message
 *  back; `clear` drops it on a send. */
function useAttachRefusal(selectedModel: string | null | undefined) {
  const [refusedFor, setRefusedFor] = useState<string | null>(null);
  if (refusedFor !== null && refusedFor !== selectedModel) {
    setRefusedFor(null);
  }
  return {
    refused: refusedFor !== null,
    refuse: () => setRefusedFor(selectedModel ?? null),
    clear: () => setRefusedFor(null),
  };
}

/**
 * The composer's attached images: paste, picker, and drop add them (images
 * of an attachable type only, up to {@link MAX_COMPOSER_ATTACHMENTS}), each
 * uploads immediately, and a selected model without image input refuses new
 * attachments and blocks sending the attached ones.
 */
export function useComposerAttachments(): ComposerAttachments {
  const { items, itemsRef, update } = useAttachmentList();
  const upload = useUploader(update);
  const edits = useAttachmentEdits(itemsRef, update, upload);
  const support = useImageInputSupport();
  const refusal = useAttachRefusal(support.selectedModel);

  const add = (files: Iterable<File>) => {
    const images = Array.from(files).filter((file) =>
      ATTACHABLE_IMAGE_TYPES.includes(file.type),
    );
    if (images.length === 0) return;
    if (support.imageInputMissing) {
      refusal.refuse();
      return;
    }
    const room = MAX_COMPOSER_ATTACHMENTS - itemsRef.current.length;
    const added = images.slice(0, Math.max(room, 0)).map((file) => ({
      key: safeRandomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      status: "uploading" as const,
    }));
    update((current) => [...current, ...added]);
    for (const { key, file } of added) upload(key, file);
  };

  const imagesRefused = support.imageInputMissing && items.length > 0;
  const blocked =
    imagesRefused || (support.imageInputMissing && refusal.refused);
  return {
    items,
    add,
    ...edits,
    replace: (next) => {
      refusal.clear();
      edits.replace(next);
    },
    blockReason: blocked ? `${support.label} has no image input` : null,
    sendBlocked: imagesRefused || items.some((item) => item.status !== "ready"),
  };
}
