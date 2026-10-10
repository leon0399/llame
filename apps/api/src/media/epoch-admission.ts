import { isRecord, isString } from '@workspace/runtime-safety';
import type { FilePart, ModelMessage, ToolResultPart } from 'ai';

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

export type MediaAdmission = 'attached' | 'limit' | 'unavailable';

/**
 * The epoch image window (vision-media D6, Q22): references in request order,
 * oldest first, a repeated id counting again. An unresolvable reference is
 * `unavailable` and counts toward nothing. Resolvable references attach while
 * at most 100 images and 24 MiB of base64 model variants hold; the first one
 * that would exceed either bound, and every later resolvable one, is `limit`.
 *
 * Append-only: the statuses of a prefix of `refs` never depend on what follows
 * it, so a request prefix keeps its attachments as turns and steps are added.
 */
export function admitEpochImages(
  refs: ReadonlyArray<string>,
  descriptors: ReadonlyMap<string, MediaDescriptor>,
): ReadonlyArray<MediaAdmission> {
  let images = 0;
  let base64Bytes = 0;
  let full = false;
  return refs.map((id) => {
    const descriptor = descriptors.get(id);
    if (descriptor === undefined) return 'unavailable';
    if (full) return 'limit';
    const size = 4 * Math.ceil(descriptor.modelByteSize / 3);
    if (
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

/**
 * The media id a native `read` image result names (vision-media D7), or
 * undefined for every other result.
 */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- a stored or live tool result is arbitrary JSON; `isRecord` and the field checks below narrow it.
export function imageResultMediaId(result: unknown): string | undefined {
  return isRecord(result) &&
    result.status === 'success' &&
    result.kind === 'image' &&
    isString(result.media)
    ? parseMediaLocator(result.media)
    : undefined;
}

/**
 * A tool output of `text`, followed for an image result by its `media://`
 * reference as an `image-url` part. Live and replayed results both carry the
 * reference only, never bytes: the step composer alone turns it into an image
 * or a placeholder on every step (vision-media D6).
 */
export function toolResultOutput(
  text: string,
  imageId: string | undefined,
): ToolResultOutput {
  return imageId === undefined
    ? { type: 'text', value: text }
    : {
        type: 'content',
        value: [
          { type: 'text', text },
          { type: 'image-url', url: mediaLocator(imageId) },
        ],
      };
}

/**
 * One media reference of a request: its id, and whether a tool result rather
 * than an owner file part carries it.
 */
export type MediaRef = { id: string; tool: boolean };

/**
 * Every media reference of a request, in request order: the `media://` file
 * parts of user messages (owner attachments, `buildContext`) and the
 * `media://` image references of tool results (`read` image results, live or
 * replayed).
 */
export function collectMediaRefs(
  messages: ReadonlyArray<ModelMessage>,
): Array<MediaRef> {
  return messages.flatMap((message): Array<MediaRef> => {
    if (message.role === 'user' && Array.isArray(message.content)) {
      return message.content.flatMap((part) => {
        const id = part.type === 'file' ? fileMediaRef(part) : undefined;
        return id === undefined ? [] : [{ id, tool: false }];
      });
    }
    if (message.role !== 'tool') return [];
    return message.content.flatMap((part) =>
      part.type === 'tool-result' && part.output.type === 'content'
        ? part.output.value.flatMap((item) => {
            const id = toolOutputMediaRef(item);
            return id === undefined ? [] : [{ id, tool: true }];
          })
        : [],
    );
  });
}

/**
 * How a request's media references are projected (vision-media D6): the
 * owner's descriptors for them and their epoch admission, in request order,
 * for a model that does or does not declare `image` input. The step composer
 * projects a request from it; the estimators size one with it.
 *
 * A continuation estimate sizes only the request's trailing rows, so its
 * consumers align `statuses` to the END of the messages they project.
 */
export type MediaSizing = {
  descriptors: ReadonlyMap<string, MediaDescriptor>;
  statuses: ReadonlyArray<MediaAdmission>;
  imageInput: boolean;
};

/**
 * Collect `messages`' references, describe them, and admit them; `refs` are
 * the references `statuses` are aligned with.
 */
export async function loadMediaSizing(
  messages: ReadonlyArray<ModelMessage>,
  resolver: RunMediaResolver,
  imageInput: boolean,
): Promise<MediaSizing & { refs: ReadonlyArray<MediaRef> }> {
  const refs = collectMediaRefs(messages);
  const ids = refs.map((ref) => ref.id);
  const descriptors = await resolver.describe(ids);
  return {
    refs,
    descriptors,
    statuses: admitEpochImages(ids, descriptors),
    imageInput,
  };
}
