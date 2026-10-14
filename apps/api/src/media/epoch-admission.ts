import { isRecord, isString } from '@workspace/runtime-safety';
import type { FilePart, ImagePart, ModelMessage, ToolResultPart } from 'ai';
import { z } from 'zod';

import type { ModelInput } from '../models/model-catalog';
import type { HeldImage, UnstoredImage } from './attempt-images';
import type { MediaDescriptor, RunMediaResolver } from './media-descriptors';
import { mediaLocator, parseMediaLocator } from './media-locator';
import { PDF_MAX_PAGES } from './pdf-preparation';

export type ToolResultOutput = ToolResultPart['output'];
export type ToolContentPart = Extract<
  ToolResultOutput,
  { type: 'content' }
>['value'][number];

/** Images one epoch may attach: Anthropic's per-request limit (vision-media D6). */
export const EPOCH_MAX_IMAGES = 100;
/**
 * Summed base64 size of the attached images and PDFs: 28 MiB, the smallest
 * round bound that admits one 20 MiB PDF (pdf-media D5).
 */
export const EPOCH_MAX_BASE64_BYTES = 29_360_128;
/** The tokens an estimate charges each attached PDF page (pdf-media D6). */
export const PDF_PAGE_TOKENS = 3000;
/**
 * `COMPACTION_WINDOW_RATIO`, restated: `compaction.ts` imports the step
 * composer, which imports this module, so importing it here would be a cycle.
 */
const PDF_WINDOW_RATIO = 0.8;

/** The base64 length of `byteSize` bytes, as the window counts a variant. */
export function base64Size(byteSize: number): number {
  return 4 * Math.ceil(byteSize / 3);
}

/**
 * The request's model as the epoch media window sees it: the kinds it
 * declares as input, and the window and output reserve its PDF page bound is
 * relative to.
 */
export type MediaAdmissionContext = {
  input: ReadonlyArray<ModelInput>;
  contextWindowTokens: number;
  reservedOutputTokens: number | null;
};

/**
 * The PDF pages one epoch may attach for the request's model (pdf-media D5):
 * the smaller of the per-PDF ingest bound and what 80% of the window, less the
 * output reserve, holds at 3,000 tokens a page, so attached PDFs alone never
 * reach the default compaction threshold.
 */
export function pdfPageBound(ctx: MediaAdmissionContext): number {
  const budget = Math.max(
    0,
    ctx.contextWindowTokens * PDF_WINDOW_RATIO -
      (ctx.reservedOutputTokens ?? 0),
  );
  return Math.min(PDF_MAX_PAGES, Math.floor(budget / PDF_PAGE_TOKENS));
}

/**
 * An unstored image as the window sees it (vision-media R1.4), by what the
 * current attempt's memory holds for it: no entry (`not-retained`), or an
 * entry holding its model variant (`held`), sized like a stored one.
 */
export type UnstoredImageRef =
  | { readonly unstored: 'not-retained' }
  | { readonly unstored: 'held'; readonly modelByteSize: number };

/** One media reference of a request: a `media://` id or an unstored image. */
export type EpochMediaRef = string | UnstoredImageRef;

export type MediaAdmission =
  | 'attached'
  | 'limit'
  | 'omitted'
  | 'unavailable'
  | 'not-retained';

/** What one attachable reference counts toward the window's bounds. */
type WindowCost = { bytes: number; images: number; pages: number };

/**
 * The epoch media window (vision-media D6, Q22; pdf-media D5): references in
 * request order, oldest first, a repeated id counting again. Only attachable
 * references count: one of a kind `ctx.input` declares, and either a
 * `media://` id the owner's store resolves or an unstored image the attempt's
 * memory holds an entry for. An unresolvable id is `unavailable`, a resolvable
 * reference of an undeclared kind `omitted`, and an unstored image without an
 * entry `not-retained`; none counts toward anything. Attachable references
 * attach while at most 100 images, 28 MiB of base64 (an image's model variant,
 * a PDF's original), and `pdfPageBound(ctx)` PDF pages hold; the first one
 * that would exceed any bound, and every later attachable one, is `limit`.
 *
 * Append-only: the statuses of a prefix of `refs` never depend on what follows
 * it, so a request prefix keeps its attachments as turns and steps are added.
 */
export function admitEpochMedia(
  refs: ReadonlyArray<EpochMediaRef>,
  descriptors: ReadonlyMap<string, MediaDescriptor>,
  ctx: MediaAdmissionContext,
): ReadonlyArray<MediaAdmission> {
  const maxPages = pdfPageBound(ctx);
  const used: WindowCost = { bytes: 0, images: 0, pages: 0 };
  let full = false;
  return refs.map((ref) => {
    const cost = windowCost(ref, descriptors, ctx.input);
    if (isString(cost)) return cost;
    full ||=
      used.images + cost.images > EPOCH_MAX_IMAGES ||
      used.bytes + cost.bytes > EPOCH_MAX_BASE64_BYTES ||
      used.pages + cost.pages > maxPages;
    if (full) return 'limit';
    used.images += cost.images;
    used.bytes += cost.bytes;
    used.pages += cost.pages;
    return 'attached';
  });
}

/**
 * What an attachable reference counts, or the status of a reference that never
 * counts. A missing kind outranks retention (pdf-media D4).
 */
function windowCost(
  ref: EpochMediaRef,
  descriptors: ReadonlyMap<string, MediaDescriptor>,
  input: ReadonlyArray<ModelInput>,
): WindowCost | 'unavailable' | 'omitted' | 'not-retained' {
  if (!isString(ref)) {
    if (!input.includes('image')) return 'omitted';
    return ref.unstored === 'held'
      ? { bytes: base64Size(ref.modelByteSize), images: 1, pages: 0 }
      : 'not-retained';
  }
  const d = descriptors.get(ref);
  if (d === undefined) return 'unavailable';
  if (!input.includes(d.kind)) return 'omitted';
  return d.kind === 'pdf'
    ? { bytes: base64Size(d.byteSize), images: 0, pages: d.pages }
    : { bytes: base64Size(d.modelByteSize), images: 1, pages: 0 };
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

const unstoredRefSchema = unstoredImageSchema.extend({ key: z.string() });

/** The provider-options key of an unstored image's reference part. */
const UNSTORED_IMAGE_OPTION = 'llameUnstoredImage';

/**
 * The reference a model-message image part carries, or undefined: the
 * unstored image or `media://` id `buildContext` emits after a prompt-imports
 * item's text (vision-media D8, see `userImagePart`); projected images carry
 * bytes.
 */
export function userImageRef(part: ImagePart): MediaRef | undefined {
  const unstored = unstoredRefSchema.safeParse(
    part.providerOptions?.[UNSTORED_IMAGE_OPTION],
  );
  if (unstored.success) return unstored.data;
  return isString(part.image) ? parseMediaLocator(part.image) : undefined;
}

/**
 * The image part referencing `ref` in a user message: a `media://` string, or
 * an unstored image, keyed by its prompt-import entry, in llame's own provider
 * option. The step composer replaces it on every step, so it never reaches a
 * provider adapter.
 */
export function userImagePart(ref: MediaRef): ImagePart {
  return isString(ref)
    ? { type: 'image', image: mediaLocator(ref) }
    : {
        type: 'image',
        image: '',
        providerOptions: { [UNSTORED_IMAGE_OPTION]: ref },
      };
}

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

/**
 * An unstored image reference of a request, keyed by its tool call id or its
 * prompt-import entry.
 */
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
 * parts of user messages (owner attachments, `buildContext`), the image
 * references of user messages (prompt-import images, stored or unstored), and
 * the image references of tool results (`read` image results, live or
 * replayed).
 */
export function collectMediaRefs(
  messages: ReadonlyArray<ModelMessage>,
): Array<MediaRef> {
  return messages.flatMap((message): Array<MediaRef> => {
    if (message.role === 'user' && Array.isArray(message.content)) {
      return message.content.flatMap((part) => {
        const ref =
          part.type === 'file'
            ? fileMediaRef(part)
            : part.type === 'image'
              ? userImageRef(part)
              : undefined;
        return ref === undefined ? [] : [ref];
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
 * its unstored ones, and their epoch admission, in request order, under the
 * request's model (`context`). The step composer projects a request from it;
 * the estimators size one with it.
 *
 * A continuation estimate sizes only the request's trailing rows, so its
 * consumers align `statuses` to the END of the messages they project.
 */
export type MediaSizing = {
  descriptors: ReadonlyMap<string, MediaDescriptor>;
  held: ReadonlyMap<string, HeldImage>;
  statuses: ReadonlyArray<MediaAdmission>;
  context: MediaAdmissionContext;
};

/**
 * Collect `messages`' references, describe the stored ones, look the unstored
 * ones up in the attempt's memory, and admit them under `context`; `refs` are
 * the references `statuses` are aligned with.
 */
export async function loadMediaSizing(
  messages: ReadonlyArray<ModelMessage>,
  resolver: RunMediaResolver,
  context: MediaAdmissionContext,
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
    statuses: admitEpochMedia(
      refs.map((ref) => epochRef(ref, held)),
      descriptors,
      context,
    ),
    context,
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
): EpochMediaRef {
  if (isString(image)) return image;
  const entry = held.get(image.key);
  const modelByteSize = entry?.model?.bytes.byteLength ?? entry?.modelByteSize;
  return modelByteSize === undefined
    ? { unstored: 'not-retained' }
    : { unstored: 'held', modelByteSize };
}
