import { isRecord, isString } from '@workspace/runtime-safety';
import type { FilePart, ModelMessage, ToolResultPart } from 'ai';
import { z } from 'zod';

import type { HeldImage, UnstoredImage } from './attempt-images';
import type { MediaDescriptor, RunMediaResolver } from './media-descriptors';
import { mediaLocator, parseMediaLocator } from './media-locator';

export type ToolResultOutput = ToolResultPart['output'];
export type ToolContentPart = Extract<
  ToolResultOutput,
  { type: 'content' }
>['value'][number];

/** Images one epoch may attach: Anthropic's per-request limit (vision-media D6). */
export const EPOCH_MAX_IMAGES = 100;
/** Summed base64 size of the attached model variants: 24 MiB. */
export const EPOCH_MAX_BASE64_BYTES = 25_165_824;

/** The base64 length of `byteSize` bytes, as the window counts a variant. */
export function base64Size(byteSize: number): number {
  return 4 * Math.ceil(byteSize / 3);
}

/**
 * An unstored image as the window sees it (vision-media R1.4), by what the
 * current attempt's memory holds for it: no entry (`not-retained`), or an
 * entry holding its model variant (`held`), sized like a stored one.
 */
export type UnstoredImageRef =
  | { readonly unstored: 'not-retained' }
  | { readonly unstored: 'held'; readonly modelByteSize: number };

/** One image reference of a request: a `media://` id or an unstored image. */
export type EpochImageRef = string | UnstoredImageRef;

export type MediaAdmission =
  | 'attached'
  | 'limit'
  | 'unavailable'
  | 'not-retained';

/**
 * The epoch image window (vision-media D6, Q22): references in request order,
 * oldest first, a repeated id counting again. Only attachable references
 * count: a `media://` id the owner's store resolves, or an unstored image the
 * attempt's memory holds an entry for. An unresolvable id is `unavailable` and
 * an unstored image without an entry is `not-retained`; neither counts toward
 * anything. Attachable references attach while at most 100 images and 24 MiB
 * of base64 model variants hold; the first one that would exceed either bound,
 * and every later attachable one, is `limit`.
 *
 * Append-only: the statuses of a prefix of `refs` never depend on what follows
 * it, so a request prefix keeps its attachments as turns and steps are added.
 */
export function admitEpochImages(
  refs: ReadonlyArray<EpochImageRef>,
  descriptors: ReadonlyMap<string, MediaDescriptor>,
): ReadonlyArray<MediaAdmission> {
  let images = 0;
  let base64Bytes = 0;
  let full = false;
  return refs.map((ref) => {
    const counted = countedBytes(ref, descriptors);
    if (counted === 'unavailable' || counted === 'not-retained') {
      return counted;
    }
    const size = base64Size(counted);
    if (
      full ||
      images === EPOCH_MAX_IMAGES ||
      base64Bytes + size > EPOCH_MAX_BASE64_BYTES
    ) {
      full = true;
      return 'limit';
    }
    images += 1;
    base64Bytes += size;
    return 'attached';
  });
}

/**
 * The model variant byte size an attachable reference counts, or the status
 * of a reference that never counts.
 */
function countedBytes(
  ref: EpochImageRef,
  descriptors: ReadonlyMap<string, MediaDescriptor>,
): number | 'unavailable' | 'not-retained' {
  if (isString(ref)) {
    return descriptors.get(ref)?.modelByteSize ?? 'unavailable';
  }
  return ref.unstored === 'held' ? ref.modelByteSize : 'not-retained';
}

/**
 * The media id a model-message file part references, or undefined. The SDK's
 * `data` may also be bytes or a URL; only a `media://` string is a reference.
 */
export function fileMediaRef(part: FilePart): string | undefined {
  return isString(part.data) ? parseMediaLocator(part.data) : undefined;
}

/** The media id a tool output's `image-url` part references, or undefined. */
export function toolOutputMediaRef(part: ToolContentPart): string | undefined {
  return part.type === 'image-url' ? parseMediaLocator(part.url) : undefined;
}

const unstoredImageSchema = z.object({
  locator: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/** The provider-options key of an unstored image's reference part. */
const UNSTORED_IMAGE_OPTION = 'llameUnstoredImage';

/**
 * The unstored image a tool output's `custom` reference part names, or
 * undefined. The part is llame's own: the step composer replaces it on every
 * step, so it never reaches a provider adapter.
 */
export function toolOutputUnstoredImage(
  part: ToolContentPart,
): UnstoredImage | undefined {
  if (part.type !== 'custom') return undefined;
  const parsed = unstoredImageSchema.safeParse(
    part.providerOptions?.[UNSTORED_IMAGE_OPTION],
  );
  return parsed.success ? parsed.data : undefined;
}

/**
 * The image a `read` result names: a stored object's media id, or an unstored
 * image by its submitted locator and original dimensions.
 */
export type ToolImageRef = string | UnstoredImage;

/** The locator a native `read` call submitted, or undefined. */
export function submittedLocator(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  return isString(input.path) ? input.path : undefined;
}

/**
 * The image a native `read` result names (vision-media D7): the media id of a
 * `media://` result, or for any other image result `locator`, the one its call
 * submitted, with the original's dimensions; undefined for every other result.
 */
export function imageResultRef(
  result: unknown,
  locator: string | undefined,
): ToolImageRef | undefined {
  if (!isRecord(result)) return undefined;
  if (result.status !== 'success' || result.kind !== 'image') return undefined;
  if (result.media !== undefined) {
    return isString(result.media) ? parseMediaLocator(result.media) : undefined;
  }
  const parsed = unstoredImageSchema.safeParse({
    locator,
    width: result.width,
    height: result.height,
  });
  return parsed.success ? parsed.data : undefined;
}

/**
 * A tool output of `text`, followed for an image result by its reference: an
 * `image-url` part for a `media://` image, a `custom` part for an unstored
 * one. Live and replayed results both carry the reference only, never bytes:
 * the step composer alone turns it into an image or a placeholder on every
 * step (vision-media D6).
 */
export function toolResultOutput(
  text: string,
  image: ToolImageRef | undefined,
): ToolResultOutput {
  if (image === undefined) return { type: 'text', value: text };
  return {
    type: 'content',
    value: [
      { type: 'text', text },
      isString(image)
        ? { type: 'image-url', url: mediaLocator(image) }
        : {
            type: 'custom',
            providerOptions: { [UNSTORED_IMAGE_OPTION]: image },
          },
    ],
  };
}

/** An unstored image reference of a request, keyed by its tool call id. */
export type UnstoredRef = UnstoredImage & { key: string };

/** One media reference of a request: a media id or an unstored image. */
export type MediaRef = string | UnstoredRef;

/**
 * The reference one item of the tool result with call id `key` carries: a
 * `media://` id, an unstored image, or undefined.
 */
export function toolItemRef(
  item: ToolContentPart,
  key: string,
): string | UnstoredRef | undefined {
  const unstored = toolOutputUnstoredImage(item);
  return unstored === undefined
    ? toolOutputMediaRef(item)
    : { ...unstored, key };
}

/**
 * Every media reference of a request, in request order: the `media://` file
 * parts of user messages (owner attachments, `buildContext`) and the image
 * references of tool results (`read` image results, live or replayed).
 */
export function collectMediaRefs(
  messages: ReadonlyArray<ModelMessage>,
): Array<MediaRef> {
  return messages.flatMap((message): Array<MediaRef> => {
    if (message.role === 'user' && Array.isArray(message.content)) {
      return message.content.flatMap((part) => {
        const id = part.type === 'file' ? fileMediaRef(part) : undefined;
        return id === undefined ? [] : [id];
      });
    }
    if (message.role !== 'tool') return [];
    return message.content.flatMap((part) =>
      part.type === 'tool-result' && part.output.type === 'content'
        ? part.output.value.flatMap((item) => {
            const image = toolItemRef(item, part.toolCallId);
            return image === undefined ? [] : [image];
          })
        : [],
    );
  });
}

/**
 * How a request's media references are projected (vision-media D6): the
 * owner's descriptors for its stored references, the attempt's entries for
 * its unstored ones, and their epoch admission, in request order, for a model
 * that does or does not declare `image` input, on a wire that does or does not
 * move tool-result images into a user message. The step composer projects a
 * request from it; the estimators size one with it.
 *
 * A continuation estimate sizes only the request's trailing rows, so its
 * consumers align `statuses` to the END of the messages they project.
 */
export type MediaSizing = {
  descriptors: ReadonlyMap<string, MediaDescriptor>;
  held: ReadonlyMap<string, HeldImage>;
  statuses: ReadonlyArray<MediaAdmission>;
  imageInput: boolean;
  /** Whether tool-result images move into a user message (Chat Completions wires). */
  moveToolImages?: boolean;
};

/**
 * Collect `messages`' references, describe the stored ones, look the unstored
 * ones up in the attempt's memory, and admit them; `refs` are the references
 * `statuses` are aligned with.
 */
export async function loadMediaSizing(
  messages: ReadonlyArray<ModelMessage>,
  resolver: RunMediaResolver,
  imageInput: boolean,
  { moveToolImages = false }: { moveToolImages?: boolean } = {},
): Promise<MediaSizing & { refs: ReadonlyArray<MediaRef> }> {
  const refs = collectMediaRefs(messages);
  const descriptors = await resolver.describe(refs.filter(isString));
  const held = new Map<string, HeldImage>();
  for (const ref of refs) {
    if (isString(ref)) continue;
    const entry = resolver.images.get(ref.key);
    if (entry !== undefined) held.set(ref.key, entry);
  }
  return {
    refs,
    descriptors,
    held,
    statuses: admitEpochImages(
      refs.map((ref) => epochRef(ref, held)),
      descriptors,
    ),
    imageInput,
    moveToolImages,
  };
}

/**
 * A request reference as the epoch window sees it. A released entry keeps its
 * variant's byte size, so the append-only window re-derives the `limit` it
 * gave the entry when it refused it; an entry that never held a variant (a
 * text-only model's) is `not-retained`.
 */
function epochRef(
  image: string | UnstoredRef,
  held: ReadonlyMap<string, HeldImage>,
): EpochImageRef {
  if (isString(image)) return image;
  const entry = held.get(image.key);
  const modelByteSize = entry?.model?.bytes.byteLength ?? entry?.modelByteSize;
  return modelByteSize === undefined
    ? { unstored: 'not-retained' }
    : { unstored: 'held', modelByteSize };
}
