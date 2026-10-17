import { isString } from '@workspace/runtime-safety';
import type { ModelMessage, streamText, UserContent } from 'ai';

import { releaseImage, type HeldImage } from '../media/attempt-images';
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

export type ComposeStepOptions = {
  resolver: RunMediaResolver;
  /** The request's model: its declared input, window, and output reserve. */
  context: MediaAdmissionContext;
  /**
   * Whether tool-result images move into a following user message: on the
   * Chat Completions wires, whose adapter serializes tool content as text
   * (vision-media D6). Other wires keep them in the tool output.
   */
  moveToolImages?: boolean;
};

export type UserContentPart = Exclude<UserContent, string>[number];

/** What one media reference projects to, in either message role. */
export type ProjectedMedia =
  | { type: 'text'; text: string }
  | { type: 'image'; image: Uint8Array; mediaType: string }
  | { type: 'file'; data: Uint8Array; mediaType: string; filename: string };

/**
 * A reference the epoch window attaches, and where its bytes come from: the
 * store for a stored object, or the attempt's memory for an unstored image.
 * An image carries its model variant's dimensions and format; a PDF its page
 * count and stored name (pdf-media D4).
 */
export type AttachedMedia =
  | {
      kind: 'image';
      modelWidth: number;
      modelHeight: number;
      modelMediaType: string;
      source: { id: string } | { bytes: Uint8Array };
    }
  | { kind: 'pdf'; pages: number; filename: string; source: { id: string } };

/** A resolvable reference: its subject, and its attachment when attachable. */
type ResolvedMedia = { subject: MediaSubject; attached?: AttachedMedia };

/**
 * The one place media references become what a model sees (vision-media D6,
 * pdf-media D4). Within each user message, its `media://` file parts are
 * numbered per kind from 1 and each becomes the label `Image n
 * (media://<id>):` or `PDF n (media://<id>):` followed by its projection; a
 * tool result's image reference becomes its projection after the result's
 * text. The forms are those of `projectMediaRefs`; an attached image is the
 * model variant, loaded from the store for a `media://` reference and taken
 * from the attempt's memory for an unstored image, and an attached PDF is the
 * stored original as a `file` part named by its stored name. With
 * `moveToolImages`, tool-result images move out of the tool messages (see
 * `mapMediaRefs`). Only the stored bytes of attached references are loaded.
 *
 * An unstored image enters the attempt's window when it is first composed, in
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
  { resolver, context, moveToolImages = false }: ComposeStepOptions,
): Promise<Array<ModelMessage>> {
  const sizing = await loadMediaSizing(messages, resolver, context);
  if (sizing.refs.length === 0) return messages;
  sizing.refs.forEach((ref, index) => {
    if (!isString(ref) && sizing.statuses[index] !== 'attached') {
      releaseImage(resolver.images, ref.key);
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
    moveToolImages,
  );
}

/**
 * An attached reference with its bytes: an unstored image's model variant
 * from the attempt's memory, a stored image's model variant or a stored PDF's
 * original from `loaded`. A stored blob that could not be read is as
 * unresolvable as a missing one.
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
 * for the placement and `moveToolImages`). Each reference takes one form, in
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
  moveToolImages: boolean,
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
      return project(unstoredImage(ref, sizing.held), status);
    }
    const descriptor = sizing.descriptors.get(ref);
    return descriptor === undefined
      ? textOf(unavailablePlaceholder(ref, kind))
      : project(storedMedia(ref, descriptor), status);
  };
  return mapMediaRefs(messages, projectRef, moveToolImages);
}

/** The bytes a sized projection gives each attached reference (see `projectSizedText`). */
const UNSIZED = new Uint8Array(0);

/**
 * `messages` as the composer projects them under `sizing` (see
 * `projectMediaRefs`), with tool-result images moved out of the tool messages
 * (see `mapMediaRefs`) and every attached reference passed to `charge` and
 * then left out: the text an estimate counts, header and labels included,
 * while an image itself is charged by its dimensions (vision-media D6) and a
 * PDF by its pages (pdf-media D6).
 *
 * The move is applied on every wire, though only the Chat Completions wires
 * send it: the estimate is then exact there and, elsewhere, an upper bound at
 * most a few tokens per tool-result image larger (its label and the `Images
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

/** An unstored image, attachable only while the attempt retains its variant. */
function unstoredImage(
  ref: UnstoredRef,
  held: ReadonlyMap<string, HeldImage>,
): ResolvedMedia {
  const subject = unstoredSubject(ref);
  const model = held.get(ref.key)?.model;
  return model === undefined
    ? { subject }
    : {
        subject,
        attached: {
          kind: 'image',
          modelWidth: model.width,
          modelHeight: model.height,
          modelMediaType: model.mediaType,
          source: { bytes: model.bytes },
        },
      };
}

/** The header of the user message moved tool-result images follow. */
const MOVED_IMAGES_HEADER = 'Images from tool results:';

/** A tool message's text when its envelope would be empty once its image moves. */
const IMAGE_FOLLOWS = 'The image follows in the next message.';

/**
 * Replace each media reference of `messages`, in request order, with
 * `project(ref, index, kind)`, where `index` is the reference's position among
 * all of `messages`' references and `kind` the kind its part declares (a file
 * part's stored `mediaType`; every other reference is an image). A user
 * message's `media://` file part is preceded by its label `Image n
 * (media://<id>):` or `PDF n (media://<id>):` (n counting that message's file
 * references of the same kind from 1); its image reference part (a
 * prompt-import image, stored or unstored) is projected in place, unlabelled,
 * right after the item's text. A tool result's image reference is projected in
 * place after the result's text, an image becoming `image-data`; a result left
 * with text alone becomes a text output of those texts joined by newlines.
 *
 * With `moveToolImages`, for the Chat Completions wires (vision-media D6,
 * after OMP's `openai-completions`), a tool result's projected images leave
 * its tool message instead: the images of a run of consecutive tool messages
 * follow it in one user message opened by `Images from tool results:`, in
 * tool-result order, each preceded by `Image from <toolName> <locator>:`, the
 * locator being the JSON string literal of the one the call submitted, or of
 * `media://<id>` for a stored image (R2.15). A tool result left with no text
 * says the image follows in the next message. A run without images gains no
 * message.
 *
 * Messages without references are returned as the same objects.
 */
export function mapMediaRefs(
  messages: Array<ModelMessage>,
  project: ProjectRef,
  moveToolImages = false,
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
      content: [
        { type: 'text', text: MOVED_IMAGES_HEADER },
        ...moved.splice(0),
      ],
    });
  };
  for (const message of messages) {
    if (message.role === 'tool') {
      mapped.push(mapToolRefs(message, next, moveToolImages ? moved : null));
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
    const image = part.type === 'image' ? userImageRef(part) : undefined;
    if (image !== undefined) {
      mapped = true;
      return next(image, 'image');
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
 * A tool result with each image reference projected in place by `next` (see
 * `mapMediaRefs`), or, given `moved`, its images labelled and appended to
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
    return next(image, 'image').flatMap((projected): Array<ToolContentPart> => {
      if (projected.type === 'text') return [projected];
      if (moved === null) return [toolContentOf(projected)];
      const locator = isString(image) ? mediaLocator(image) : image.locator;
      const label = `${projected.type === 'file' ? 'PDF' : 'Image'} from ${part.toolName} ${JSON.stringify(locator)}:`;
      moved.push({ type: 'text', text: label }, projected);
      return [];
    });
  });
  const output = toolOutput(value);
  const emptied =
    (moved?.length ?? 0) > movedBefore &&
    output.type === 'text' &&
    output.value === '';
  return {
    ...part,
    output: emptied ? { type: 'text', value: IMAGE_FOLLOWS } : output,
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
 * with the stream input's `reservedOutputTokens`. `moveToolImages` is set by
 * the Chat Completions wires (see `ComposeStepOptions`).
 */
export function installStepPreparation(
  streamOptions: Parameters<typeof streamText>[0],
  input: ModelStreamInput,
  model: { input?: ReadonlyArray<ModelInput>; contextWindowTokens: number },
  { moveToolImages = false }: { moveToolImages?: boolean } = {},
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
            moveToolImages,
          });
    return {
      ...(composed && { messages: composed }),
      ...(capReached && { activeTools: [] }),
    };
  };
}
