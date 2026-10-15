import { isString } from '@workspace/runtime-safety';
import type { ModelMessage, streamText, UserContent } from 'ai';

import { releaseMedia, type HeldMedia } from '../media/attempt-media';
import {
  collectMediaRefs,
  fileMediaRef,
  loadMediaSizing,
  toolItemRef,
  userImageRef,
  type MediaAdmission,
  type MediaAdmissionContext,
  type MediaRef,
  type MediaSizing,
  type ToolContentPart,
  type ToolResultOutput,
  type UnstoredRef,
} from '../media/epoch-admission';
import {
  fileKind,
  limitPlaceholder,
  notRetainedPlaceholder,
  omittedPlaceholder,
  storedSubject,
  unavailablePlaceholder,
  unstoredSubject,
  type MediaDescriptor,
  type MediaKind,
  type MediaSubject,
  type RunMediaResolver,
} from '../media/media-descriptors';
import { mediaLocator } from '../media/media-locator';
import { PDF_MEDIA_TYPE } from '../media/pdf-preparation';
import type { ModelInput } from './model-catalog';
import type { ModelStreamInput } from './model-client';
import { basename } from 'node:path';

export type ComposeStepOptions = {
  resolver: RunMediaResolver;
  /** The request's model: its declared input, window, and output reserve. */
  context: MediaAdmissionContext;
  /**
   * Whether tool-result media move into a following user message: on the
   * Chat Completions wires, whose adapter serializes tool content as text
   * (vision-media D6). Other wires keep them in the tool output.
   */
  moveToolMedia?: boolean;
};

export type UserContentPart = Exclude<UserContent, string>[number];

/** What one media reference projects to, in either message role. */
export type ProjectedMedia =
  | { type: 'text'; text: string }
  | { type: 'image'; image: Uint8Array; mediaType: string }
  | { type: 'file'; data: Uint8Array; mediaType: string; filename: string };

/**
 * A reference the epoch window attaches, and where its bytes come from: the
 * store for a stored object, or the attempt's memory for an unstored file.
 * An image carries its model variant's dimensions and format; a PDF its page
 * count and filename (pdf-media D4).
 */
export type AttachedMedia =
  | {
      kind: 'image';
      modelWidth: number;
      modelHeight: number;
      modelMediaType: string;
      source: { id: string } | { bytes: Uint8Array };
    }
  | {
      kind: 'pdf';
      pages: number;
      filename: string;
      source: { id: string } | { bytes: Uint8Array };
    };

/** A resolvable reference: its subject, and its attachment when attachable. */
type ResolvedMedia = { subject: MediaSubject; attached?: AttachedMedia };

/**
 * The one place media references become what a model sees (vision-media D6,
 * pdf-media D4). Within each user message, its `media://` file parts are
 * numbered per kind from 1 and each becomes the label `Image n
 * (media://<id>):` or `PDF n (media://<id>):` followed by its projection; a
 * tool result's media reference becomes its projection after the result's
 * text. The forms are those of `projectMediaRefs`; an attached image is the
 * model variant, loaded from the store for a `media://` reference and taken
 * from the attempt's memory for an unstored image. An attached PDF uses its
 * original from the store or attempt's memory as a named `file` part. With
 * `moveToolMedia`, tool-result media move out of the tool messages (see
 * `mapMediaRefs`). Only the stored bytes of attached references are loaded.
 *
 * Unstored media enter the attempt's window when first composed, in
 * request order: a `read` in tool-call order, a prompt import with the
 * attempt's first request, after any compaction. One the window refuses then
 * is never attached later in the attempt, so its bytes are dropped for good
 * (R1.4).
 *
 * Idempotent: the output carries no references, and a request without any is
 * returned as is; otherwise messages without any keep their identity.
 */
export async function composeStepMessages(
  messages: Array<ModelMessage>,
  { resolver, context, moveToolMedia = false }: ComposeStepOptions,
): Promise<Array<ModelMessage>> {
  const sizing = await loadMediaSizing(messages, resolver, context);
  if (sizing.refs.length === 0) return messages;
  sizing.refs.forEach((ref, index) => {
    if (!isString(ref) && sizing.statuses[index] !== 'attached') {
      releaseMedia(resolver.heldMedia, ref.key);
    }
  });

  // One owner-scoped read for the step's attached stored references; the
  // resolver caches loaded bytes, so later steps read only ones not loaded yet.
  const sent = sizing.refs.flatMap((ref, index) =>
    isString(ref) && sizing.statuses[index] === 'attached' ? [ref] : [],
  );
  const bytes =
    sent.length === 0
      ? new Map<string, Uint8Array>()
      : await resolver.loadModelBytes([...new Set(sent)]);

  return projectMediaRefs(
    messages,
    sizing,
    (media) => attachedBytes(media, bytes),
    moveToolMedia,
  );
}

/**
 * An attached reference with its bytes, from attempt memory or `loaded`.
 * A stored blob that could not be read is as unresolvable as a missing one.
 */
function attachedBytes(
  media: AttachedMedia,
  loaded: ReadonlyMap<string, Uint8Array>,
): Array<ProjectedMedia> {
  const { source } = media;
  if ('bytes' in source) return withBytes(media, source.bytes);
  const data = loaded.get(source.id);
  return data === undefined
    ? textOf(unavailablePlaceholder(source.id, media.kind))
    : withBytes(media, data);
}

/** An attached reference as the part its kind is sent as. */
function withBytes(
  media: AttachedMedia,
  data: Uint8Array,
): Array<ProjectedMedia> {
  return media.kind === 'pdf'
    ? [
        {
          type: 'file',
          data,
          mediaType: PDF_MEDIA_TYPE,
          filename: media.filename,
        },
      ]
    : [{ type: 'image', image: data, mediaType: media.modelMediaType }];
}

/**
 * `messages` as the composer projects them under `sizing` (see `mapMediaRefs`
 * for the placement and `moveToolMedia`). Each reference takes one form, in
 * this order: the unavailable placeholder for an unresolvable `media://`
 * reference, naming the kind its part declares; the omitted one when the
 * request's model does not declare its kind; the not-retained one for an
 * unstored image the attempt holds no entry for; `attach(media)` when the
 * window attaches it; and the limit one otherwise. `sizing.statuses` is
 * aligned to the end of `messages`' references, so a continuation's trailing
 * rows project with the whole request's admission.
 */
function projectMediaRefs(
  messages: Array<ModelMessage>,
  sizing: MediaSizing,
  attach: (media: AttachedMedia) => Array<ProjectedMedia>,
  moveToolMedia: boolean,
): Array<ModelMessage> {
  const offset = sizing.statuses.length - collectMediaRefs(messages).length;
  const project = (
    { subject, attached }: ResolvedMedia,
    status: MediaAdmission | undefined,
  ): Array<ProjectedMedia> => {
    if (!sizing.context.input.includes(subject.kind)) {
      return textOf(omittedPlaceholder(subject));
    }
    if (status === 'attached' && attached !== undefined) {
      return attach(attached);
    }
    // A window-attached unstored image always has its bytes (a released entry
    // re-derives `limit`); one without them is as not retained, not an error.
    if (status === 'not-retained' || status === 'attached') {
      return textOf(notRetainedPlaceholder(subject));
    }
    return textOf(limitPlaceholder(subject));
  };
  const projectRef: ProjectRef = (ref, index, kind) => {
    const status = sizing.statuses[offset + index];
    if (!isString(ref)) {
      return project(unstoredMedia(ref, sizing.held), status);
    }
    const descriptor = sizing.descriptors.get(ref);
    return descriptor === undefined
      ? textOf(unavailablePlaceholder(ref, kind))
      : project(storedMedia(ref, descriptor), status);
  };
  return mapMediaRefs(messages, projectRef, moveToolMedia);
}

/** The bytes a sized projection gives each attached reference (see `projectSizedText`). */
const UNSIZED = new Uint8Array(0);

/**
 * `messages` as the composer projects them under `sizing` (see
 * `projectMediaRefs`), with tool-result media moved out of the tool messages
 * (see `mapMediaRefs`) and every attached reference passed to `charge` and
 * then left out: the text an estimate counts, header and labels included,
 * while an image itself is charged by its dimensions (vision-media D6) and a
 * PDF by its pages (pdf-media D6).
 *
 * The move is applied on every wire, though only the Chat Completions wires
 * send it: the estimate is then exact there and, elsewhere, an upper bound at
 * most a few tokens per tool-result file larger (its label and the `Files
 * from tool results:` header), so admission and compaction need not know the
 * client's wire.
 */
export function projectSizedText(
  messages: Array<ModelMessage>,
  sizing: MediaSizing,
  charge: (media: AttachedMedia) => void,
): Array<ModelMessage> {
  const projected = projectMediaRefs(
    messages,
    sizing,
    (media) => {
      charge(media);
      return withBytes(media, UNSIZED);
    },
    true,
  );
  return projected.map((message): ModelMessage => {
    if (message.role !== 'user' || !Array.isArray(message.content)) {
      return message;
    }
    return {
      ...message,
      content: message.content.filter(
        (part) =>
          !(part.type === 'image' && part.image === UNSIZED) &&
          !(part.type === 'file' && part.data === UNSIZED),
      ),
    };
  });
}

/** A placeholder as a reference's projection. */
function textOf(text: string): Array<ProjectedMedia> {
  return [{ type: 'text', text }];
}

function unstoredPdfFilename(locator: string): string {
  const source = /^https?:\/\//iu.test(locator)
    ? new URL(locator).pathname
    : locator;
  return basename(source) || 'document.pdf';
}

function storedMedia(id: string, d: MediaDescriptor): ResolvedMedia {
  const subject = storedSubject(d);
  const source = { id };
  return d.kind === 'pdf'
    ? {
        subject,
        attached: { kind: 'pdf', pages: d.pages, filename: d.name, source },
      }
    : {
        subject,
        attached: {
          kind: 'image',
          modelWidth: d.modelWidth,
          modelHeight: d.modelHeight,
          modelMediaType: d.modelMediaType,
          source,
        },
      };
}

/** An unstored media item, attachable only while the attempt retains bytes. */
function unstoredMedia(
  ref: UnstoredRef,
  held: ReadonlyMap<string, HeldMedia>,
): ResolvedMedia {
  const subject = unstoredSubject(ref);
  const entry = held.get(ref.key);
  if (entry === undefined) return { subject };
  const kind = 'pages' in ref ? 'pdf' : 'image';
  if (kind === 'pdf' && 'pages' in entry && entry.bytes !== undefined) {
    return {
      subject,
      attached: {
        kind: 'pdf',
        pages: entry.pages,
        filename: unstoredPdfFilename(ref.locator),
        source: { bytes: entry.bytes },
      },
    };
  }
  if (kind === 'image' && !('pages' in entry) && entry.model !== undefined) {
    return {
      subject,
      attached: {
        kind: 'image',
        modelWidth: entry.model.width,
        modelHeight: entry.model.height,
        modelMediaType: entry.model.mediaType,
        source: { bytes: entry.model.bytes },
      },
    };
  }
  return { subject };
}

/** The header of the user message carrying moved tool-result files. */
const MOVED_MEDIA_HEADER = 'Files from tool results:';

/** A tool message's text when its envelope would be empty after moving files. */
const MEDIA_FOLLOWS = 'The files follow in the next message.';

/**
 * Replace each media reference of `messages`, in request order, with
 * `project(ref, index, kind)`, where `index` is the reference's position among
 * all of `messages`' references and `kind` the kind its part declares through
 * its media type or reference metadata. A user
 * message's `media://` file part is preceded by its label `Image n
 * (media://<id>):` or `PDF n (media://<id>):` (n counting that message's file
 * references of the same kind from 1); its image reference part (a
 * prompt-import image, stored or unstored) is projected in place, unlabelled,
 * right after the item's text. Tool references project after the result's
 * text as `image-data` or `file-data`; text-only results join their text parts.
 *
 * With `moveToolMedia`, for the Chat Completions wires (vision-media D6,
 * after OMP's `openai-completions`), projected files from consecutive tool
 * messages follow in one user message under `Files from tool results:`.
 * Each gets an `Image from` or `PDF from <toolName> <locator>:` label, with
 * its submitted locator or stored `media://` locator JSON-quoted. An emptied
 * tool result says the files follow; a run without files gains no message.
 *
 * Messages without references are returned as the same objects.
 */
export function mapMediaRefs(
  messages: Array<ModelMessage>,
  project: ProjectRef,
  moveToolMedia = false,
): Array<ModelMessage> {
  let index = 0;
  const next: NextRef = (ref, kind) => {
    index += 1;
    return project(ref, index - 1, kind);
  };
  const mapped: Array<ModelMessage> = [];
  const moved: Array<UserContentPart> = [];
  const flush = () => {
    if (moved.length === 0) return;
    mapped.push({
      role: 'user',
      content: [{ type: 'text', text: MOVED_MEDIA_HEADER }, ...moved.splice(0)],
    });
  };
  for (const message of messages) {
    if (message.role === 'tool') {
      mapped.push(mapToolRefs(message, next, moveToolMedia ? moved : null));
      continue;
    }
    flush();
    mapped.push(mapUserRefs(message, next));
  }
  flush();
  return mapped;
}

type ProjectRef = (
  ref: MediaRef,
  index: number,
  kind: MediaKind,
) => Array<ProjectedMedia>;
type NextRef = (ref: MediaRef, kind: MediaKind) => Array<ProjectedMedia>;
type ToolMessage = Extract<ModelMessage, { role: 'tool' }>;
type ToolMessagePart = ToolMessage['content'][number];

/** A user message with its references labelled and projected. */
function mapUserRefs(message: ModelMessage, next: NextRef): ModelMessage {
  if (message.role !== 'user' || !Array.isArray(message.content)) {
    return message;
  }
  const content = mapUserContentRefs(message.content, next);
  return content === undefined ? message : { ...message, content };
}

/** How a user message's file label names each kind. */
const LABEL: Record<MediaKind, string> = { image: 'Image', pdf: 'PDF' };

/**
 * A user message's content with each reference projected by `next` (see
 * `mapMediaRefs`), or undefined when it holds none.
 */
function mapUserContentRefs(
  parts: Array<UserContentPart>,
  next: NextRef,
): Array<UserContentPart> | undefined {
  const labels: Record<MediaKind, number> = { image: 0, pdf: 0 };
  let mapped = false;
  const content = parts.flatMap((part): Array<UserContentPart> => {
    if (part.type === 'image') {
      const image = userImageRef(part);
      if (image !== undefined) {
        mapped = true;
        return next(image, fileKind(part.mediaType));
      }
    }
    if (part.type !== 'file') return [part];
    const id = fileMediaRef(part);
    if (id === undefined) return [part];
    mapped = true;
    const kind = fileKind(part.mediaType);
    labels[kind] += 1;
    const label = `${LABEL[kind]} ${labels[kind]} (${mediaLocator(id)}):`;
    return [{ type: 'text', text: label }, ...next(id, kind)];
  });
  return mapped ? content : undefined;
}

/**
 * A tool message with each result's references projected (see
 * `mapToolResultRefs`), or the same object when it has none.
 */
function mapToolRefs(
  message: ToolMessage,
  next: NextRef,
  moved: Array<UserContentPart> | null,
): ToolMessage {
  const content = message.content.map((part) =>
    mapToolResultRefs(part, next, moved),
  );
  return content.every((part, at) => part === message.content[at])
    ? message
    : { ...message, content };
}

/**
 * A tool result with each media reference projected in place by `next` (see
 * `mapMediaRefs`), or, given `moved`, its files labelled and appended to
 * `moved` instead; a part without a reference is returned as is.
 */
function mapToolResultRefs(
  part: ToolMessagePart,
  next: NextRef,
  moved: Array<UserContentPart> | null,
): ToolMessagePart {
  if (part.type !== 'tool-result' || part.output.type !== 'content') {
    return part;
  }
  const items = part.output.value;
  const refs = items.map((item) => toolItemRef(item, part.toolCallId));
  if (refs.every((ref) => ref === undefined)) return part;
  const movedBefore = moved?.length ?? 0;
  const value = items.flatMap((item, at): Array<ToolContentPart> => {
    const image = refs[at];
    if (image === undefined) return [item];
    const mediaKind: MediaKind =
      item.type === 'file-url' || (!isString(image) && 'pages' in image)
        ? 'pdf'
        : 'image';
    return next(image, mediaKind).flatMap(
      (projected): Array<ToolContentPart> => {
        if (projected.type === 'text') return [projected];
        if (moved === null) return [toolContentOf(projected)];
        const locator = isString(image) ? mediaLocator(image) : image.locator;
        const label = `${projected.type === 'file' ? 'PDF' : 'Image'} from ${part.toolName} ${JSON.stringify(locator)}:`;
        moved.push({ type: 'text', text: label }, projected);
        return [];
      },
    );
  });
  const output = toolOutput(value);
  const emptied =
    (moved?.length ?? 0) > movedBefore &&
    output.type === 'text' &&
    output.value === '';
  return {
    ...part,
    output: emptied ? { type: 'text', value: MEDIA_FOLLOWS } : output,
  };
}

/** An attached projection as a tool output part, its bytes base64-encoded. */
function toolContentOf(
  projected: Exclude<ProjectedMedia, { type: 'text' }>,
): ToolContentPart {
  if (projected.type === 'image') {
    const data = Buffer.from(projected.image).toString('base64');
    return { type: 'image-data', data, mediaType: projected.mediaType };
  }
  const { mediaType, filename } = projected;
  const data = Buffer.from(projected.data).toString('base64');
  return { type: 'file-data', data, mediaType, filename };
}

/**
 * Text-only content is sent as a text output: the Chat Completions adapter
 * serializes `content` outputs as JSON, so a placeholder would otherwise reach
 * the model wrapped in part syntax.
 */
function toolOutput(value: Array<ToolContentPart>): ToolResultOutput {
  const texts = value.flatMap((item) =>
    item.type === 'text' ? [item.text] : [],
  );
  return texts.length === value.length
    ? { type: 'text', value: texts.join('\n') }
    : { type: 'content', value };
}

/**
 * The step preparation every `ModelClient` installs, with or without tools:
 * `ai` awaits `prepareStep` on every step either way, and the composer must
 * run on every request so no `media://` reference reaches a provider adapter.
 *
 * Only `onStepStart` and the step cap are tool-loop concerns and stay gated on
 * `input.tools`. The composer runs last, on the final messages, so the in-Run
 * splice records its prefix index on untransformed messages. Without
 * `input.media` the composer is the identity. The request's model is the
 * client's declared input (`['text']` when absent) and `contextWindowTokens`,
 * with the `reservedOutputTokens`. `moveToolMedia` is set by
 * the Chat Completions wires (see `ComposeStepOptions`).
 */
export function installStepPreparation(
  streamOptions: Parameters<typeof streamText>[0],
  input: ModelStreamInput,
  model: { input?: ReadonlyArray<ModelInput>; contextWindowTokens: number },
  { moveToolMedia = false }: { moveToolMedia?: boolean } = {},
): void {
  const tools = input.tools !== undefined;
  // `null` and absent both mean "no cap" (design D1).
  const cap = input.maxSteps ?? undefined;
  const context: MediaAdmissionContext = {
    input: model.input ?? ['text'],
    contextWindowTokens: model.contextWindowTokens,
    reservedOutputTokens: input.reservedOutputTokens ?? null,
  };
  // Step-cap enforcement (SPEC tool-calling): once `maxSteps` PRIOR steps have
  // requested a tool, stop declaring tools for the next step — the model is
  // forced to answer from accumulated context in the SAME streamText() call.
  streamOptions.prepareStep = async ({ messages, stepNumber, steps }) => {
    const override = tools
      ? await input.onStepStart?.({ messages, stepNumber })
      : undefined;
    const capReached =
      tools &&
      cap !== undefined &&
      steps.filter((step) => step.toolCalls.length > 0).length >= cap;
    if (capReached) {
      input.onCapReached?.();
    }
    const composed =
      input.media === undefined
        ? override
        : await composeStepMessages(override ?? messages, {
            resolver: input.media,
            context,
            moveToolMedia,
          });
    return {
      ...(composed && { messages: composed }),
      ...(capReached && { activeTools: [] }),
    };
  };
}
