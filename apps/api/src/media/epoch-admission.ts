import { isString } from '@workspace/runtime-safety';
import type { FilePart, ModelMessage } from 'ai';

import type { MediaDescriptor, RunMediaResolver } from './media-descriptors';
import { parseMediaLocator } from './media-locator';

/** Images one epoch may attach: Anthropic's per-request limit (vision-media D6). */
export const EPOCH_MAX_IMAGES = 100;
/** Summed base64 size of the attached model variants: 24 MiB. */
export const EPOCH_MAX_BASE64_BYTES = 25_165_824;

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
    const size = 4 * Math.ceil(counted / 3);
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

/**
 * Every media reference of a request, in request order: the `media://` file
 * parts of user messages (owner attachments, `buildContext`).
 */
export function collectMediaRefs(
  messages: ReadonlyArray<ModelMessage>,
): Array<string> {
  return messages.flatMap((message) =>
    message.role === 'user' && Array.isArray(message.content)
      ? message.content.flatMap((part) => {
          const id = part.type === 'file' ? fileMediaRef(part) : undefined;
          return id === undefined ? [] : [id];
        })
      : [],
  );
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
): Promise<MediaSizing & { refs: ReadonlyArray<string> }> {
  const refs = collectMediaRefs(messages);
  const descriptors = await resolver.describe(refs);
  return {
    refs,
    descriptors,
    statuses: admitEpochImages(refs, descriptors),
    imageInput,
  };
}
