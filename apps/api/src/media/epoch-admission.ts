import { isRecord, isString } from '@workspace/runtime-safety';
import type { FilePart, ImagePart, ModelMessage, ToolResultPart } from 'ai';
import { z } from 'zod';

import type { ModelInput } from '../models/model-catalog';
import type { HeldMedia, UnstoredMedia } from './attempt-media';
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
 * An unstored reference's modality and size, independent of whether its bytes
 * have been released. Keeping the size re-derives append-only window admission.
 */
export type UnstoredMediaRef =
  | { readonly unstored: 'not-retained'; readonly kind: 'image' | 'pdf' }
  | {
      readonly unstored: 'held';
      readonly kind: 'image';
      readonly modelByteSize: number;
    }
  | {
      readonly unstored: 'held';
      readonly kind: 'pdf';
      readonly byteSize: number;
      readonly pages: number;
    };

/** One media reference of a request: a `media://` id or an unstored media. */
export type EpochMediaRef = string | UnstoredMediaRef;

/** A stored id or an attempt-local reference keyed by its tool call or import. */
export type MediaRef = string | UnstoredRef;

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
    if (!input.includes(ref.kind)) return 'omitted';
    if (ref.unstored === 'not-retained') return 'not-retained';
    return ref.kind === 'pdf'
      ? { bytes: base64Size(ref.byteSize), images: 0, pages: ref.pages }
      : { bytes: base64Size(ref.modelByteSize), images: 1, pages: 0 };
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

/** The stored media id named by an image or PDF tool reference. */
export function toolOutputMediaRef(part: ToolContentPart): string | undefined {
  return part.type === 'image-url' || part.type === 'file-url'
    ? parseMediaLocator(part.url)
    : undefined;
}

const unstoredImageSchema = z.object({
  locator: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const unstoredPdfSchema = z.object({
  locator: z.string(),
  pages: z.number().int().positive(),
});

/** Parse only the reference fields replay needs; stored bytes use their descriptor. */
const mediaReadResultSchema = z.union([
  z.object({
    status: z.literal('success'),
    kind: z.enum(['image', 'pdf']),
    media: z.string(),
  }),
  unstoredImageSchema.omit({ locator: true }).extend({
    status: z.literal('success'),
    kind: z.literal('image'),
    media: z.undefined().optional(),
  }),
  unstoredPdfSchema.omit({ locator: true }).extend({
    status: z.literal('success'),
    kind: z.literal('pdf'),
    media: z.undefined().optional(),
  }),
]);

const unstoredMediaSchema = z.union([unstoredImageSchema, unstoredPdfSchema]);
const unstoredRefSchema = z.union([
  unstoredImageSchema.extend({ key: z.string() }),
  unstoredPdfSchema.extend({ key: z.string() }),
]);

/** The provider-options key of an attempt-local media reference. */
const UNSTORED_MEDIA_OPTION = 'llameUnstoredMedia';

/**
 * The reference a model-message image part carries, or undefined: the
 * unstored media or `media://` id `buildContext` emits after a prompt-imports
 * item's text (see `userImagePart`); projected parts carry bytes instead.
 */
export function userImageRef(part: ImagePart): MediaRef | undefined {
  const unstored = unstoredRefSchema.safeParse(
    part.providerOptions?.[UNSTORED_MEDIA_OPTION],
  );
  if (unstored.success) return unstored.data;
  return isString(part.image) ? parseMediaLocator(part.image) : undefined;
}

/**
 * An SDK image-shaped reference marker for a prompt-import image or PDF. The
 * step composer replaces it with the kind's actual part on every step, so
 * this marker never reaches a provider adapter.
 */
export function userImagePart(ref: MediaRef): ImagePart {
  return isString(ref)
    ? { type: 'image', image: mediaLocator(ref) }
    : {
        type: 'image',
        image: '',
        providerOptions: { [UNSTORED_MEDIA_OPTION]: ref },
      };
}

/**
 * The unstored media a tool output's `custom` reference part names, or
 * undefined. The part is llame's own: the step composer replaces it on every
 * step, so it never reaches a provider adapter.
 */
export function toolOutputUnstoredMedia(
  part: ToolContentPart,
): UnstoredMedia | undefined {
  if (part.type !== 'custom') return undefined;
  const parsed = unstoredMediaSchema.safeParse(
    part.providerOptions?.[UNSTORED_MEDIA_OPTION],
  );
  return parsed.success ? parsed.data : undefined;
}

/**
 * The media a `read` result names: a stored image id or typed PDF id, or an
 * unstored file's submitted locator and dimensions or page count.
 */
export type ToolMediaRef = string | { kind: 'pdf'; id: string } | UnstoredMedia;

/** The locator a native `read` call submitted, or undefined. */
export function submittedLocator(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  return isString(input.path) ? input.path : undefined;
}

/**
 * A native image or PDF `read` result's reference: a stored object's id, or
 * the submitted locator with original dimensions or pages. Other results
 * carry no media reference.
 */
export function mediaResultRef(
  result: unknown,
  locator: string | undefined,
): ToolMediaRef | undefined {
  const parsed = mediaReadResultSchema.safeParse(result);
  if (!parsed.success) return undefined;
  const metadata = parsed.data;
  if (metadata.media !== undefined) {
    const id = parseMediaLocator(metadata.media);
    return id === undefined
      ? undefined
      : metadata.kind === 'pdf'
        ? { kind: 'pdf', id }
        : id;
  }
  if (locator === undefined) return undefined;
  return metadata.kind === 'pdf'
    ? { locator, pages: metadata.pages }
    : { locator, width: metadata.width, height: metadata.height };
}

/**
 * Text followed by a reference: `image-url` for a stored image, `file-url`
 * for a stored PDF, or `custom` for unstored media. Live and replayed results
 * carry references only; the step composer projects their bytes or
 * placeholders for each request.
 */
export function toolResultOutput(
  text: string,
  media: ToolMediaRef | undefined,
): ToolResultOutput {
  if (media === undefined) return { type: 'text', value: text };
  return {
    type: 'content',
    value: [
      { type: 'text', text },
      isString(media)
        ? { type: 'image-url', url: mediaLocator(media) }
        : 'id' in media
          ? { type: 'file-url', url: mediaLocator(media.id) }
          : {
              type: 'custom',
              providerOptions: { [UNSTORED_MEDIA_OPTION]: media },
            },
    ],
  };
}

/**
 * An unstored media reference of a request, keyed by its tool call id or its
 * prompt-import entry.
 */
export type UnstoredRef = UnstoredMedia & { key: string };

/**
 * The reference one item of the tool result with call id `key` carries: a
 * `media://` id, an unstored image or PDF, or undefined.
 */
export function toolItemRef(
  item: ToolContentPart,
  key: string,
): string | UnstoredRef | undefined {
  const unstored = toolOutputUnstoredMedia(item);
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
  held: ReadonlyMap<string, HeldMedia>;
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
  const held = new Map<string, HeldMedia>();
  for (const ref of refs) {
    if (isString(ref)) continue;
    const entry = resolver.heldMedia.get(ref.key);
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
 * A request reference as the epoch window sees it. Released entries retain
 * sizing, so the append-only window re-derives their refusal. An entry that
 * never held bytes for its modality is `not-retained`.
 */
function epochRef(
  ref: string | UnstoredRef,
  held: ReadonlyMap<string, HeldMedia>,
): EpochMediaRef {
  if (isString(ref)) return ref;
  const kind = 'pages' in ref ? 'pdf' : 'image';
  const entry = held.get(ref.key);
  if (entry === undefined) return { unstored: 'not-retained', kind };
  if (kind === 'pdf' && 'pages' in entry) {
    const byteSize = entry.bytes?.byteLength ?? entry.byteSize;
    return byteSize === undefined
      ? { unstored: 'not-retained', kind }
      : { unstored: 'held', kind: 'pdf', byteSize, pages: entry.pages };
  }
  if (kind === 'image' && !('pages' in entry)) {
    const modelByteSize = entry.model?.bytes.byteLength ?? entry.modelByteSize;
    return modelByteSize === undefined
      ? { unstored: 'not-retained', kind }
      : { unstored: 'held', kind: 'image', modelByteSize };
  }
  return { unstored: 'not-retained', kind };
}
