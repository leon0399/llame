import { isString } from '@workspace/runtime-safety';
import type { ModelMessage, streamText, UserContent } from 'ai';

import { releaseImage, type HeldImage } from '../media/attempt-images';
import {
  collectMediaRefs,
  fileMediaRef,
  loadMediaSizing,
  toolItemRef,
  type MediaAdmission,
  type MediaRef,
  type MediaSizing,
  type ToolContentPart,
  type ToolResultOutput,
  type UnstoredRef,
} from '../media/epoch-admission';
import {
  limitPlaceholder,
  notRetainedPlaceholder,
  omittedPlaceholder,
  storedSubject,
  unavailablePlaceholder,
  unstoredSubject,
  type ImageSubject,
  type MediaDescriptor,
  type RunMediaResolver,
} from '../media/media-descriptors';
import { mediaLocator } from '../media/media-locator';
import type { ModelInput } from './model-catalog';
import type { ModelStreamInput } from './model-client';

export type ComposeStepOptions = {
  resolver: RunMediaResolver;
  /** Whether the request's model declares `image` input. */
  imageInput: boolean;
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
  | { type: 'image'; image: Uint8Array; mediaType: string };

/**
 * An image the epoch window attaches: its model variant's dimensions and
 * format, and where its bytes come from, the store for a stored object or the
 * attempt's memory for an unstored image.
 */
export type AttachedImage = {
  modelWidth: number;
  modelHeight: number;
  modelMediaType: string;
  source: { id: string } | { bytes: Uint8Array };
};

/** A resolvable reference: its subject, and its attachment when attachable. */
type ResolvedImage = { subject: ImageSubject; attached?: AttachedImage };

/**
 * The one place media references become what a model sees (vision-media D6).
 * Within each user message, its `media://` file parts are numbered from 1 and
 * each becomes the label `Image n (media://<id>):` followed by its projection;
 * a tool result's image reference becomes its projection after the result's
 * text. The forms are those of `projectMediaRefs`; an attached image is the
 * model variant, loaded from the store for a `media://` reference and taken
 * from the attempt's memory for an unstored image. With `moveToolImages`,
 * tool-result images then move out of the tool messages (see
 * `moveToolResultImages`). Only the stored bytes of images sent as images are
 * loaded.
 *
 * An unstored image enters the attempt's window when it is first composed, in
 * request order, so in tool-call order: one the window refuses then is never
 * attached later in the attempt, so its bytes are dropped for good (R1.4).
 *
 * Idempotent: the output carries no references, and a request without any is
 * returned as is; otherwise messages without any keep their identity, except
 * tool messages under `moveToolImages`.
 */
export async function composeStepMessages(
  messages: Array<ModelMessage>,
  { resolver, imageInput, moveToolImages = false }: ComposeStepOptions,
): Promise<Array<ModelMessage>> {
  const sizing = await loadMediaSizing(messages, resolver, imageInput, {
    moveToolImages,
  });
  if (sizing.refs.length === 0) return messages;
  sizing.refs.forEach((ref, index) => {
    if (!isString(ref) && sizing.statuses[index] !== 'attached') {
      releaseImage(resolver.images, ref.key);
    }
  });

  // One owner-scoped read for the step's sent stored images; the resolver
  // caches loaded bytes, so later steps read only images not loaded yet.
  const sent = imageInput
    ? sizing.refs.flatMap((ref, index) =>
        isString(ref) && sizing.statuses[index] === 'attached' ? [ref] : [],
      )
    : [];
  const bytes =
    sent.length === 0
      ? new Map<string, Uint8Array>()
      : await resolver.loadModelBytes([...new Set(sent)]);

  return projectMediaRefs(messages, sizing, (image) =>
    attachedVariant(image, bytes),
  );
}

/**
 * An attached image's model variant as an image: an unstored image's from the
 * attempt's memory, a stored one's from `loaded`. A stored image whose blob
 * could not be read is as unresolvable as a missing one.
 */
function attachedVariant(
  { source, modelMediaType: mediaType }: AttachedImage,
  loaded: ReadonlyMap<string, Uint8Array>,
): Array<ProjectedMedia> {
  if ('bytes' in source) {
    return [{ type: 'image', image: source.bytes, mediaType }];
  }
  const image = loaded.get(source.id);
  return image === undefined
    ? [{ type: 'text', text: unavailablePlaceholder(source.id) }]
    : [{ type: 'image', image, mediaType }];
}

/**
 * `messages` with no image content left in a tool message, for the Chat
 * Completions wires (vision-media D6, after OMP's `openai-completions`): each
 * tool result's `image-data` parts are replaced by one `(image attached
 * below)` line after its other parts, and the images of a run of consecutive
 * tool messages follow it in one user message opened by `Images from tool
 * results:`, in tool-result order. A run without images gains no message.
 *
 * The output's tool messages carry no image, so a second pass changes nothing.
 */
function moveToolResultImages(
  messages: Array<ModelMessage>,
): Array<ModelMessage> {
  const moved: Array<ModelMessage> = [];
  let images: Array<UserContentPart> = [];
  const flush = () => {
    if (images.length === 0) return;
    moved.push({
      role: 'user',
      content: [{ type: 'text', text: 'Images from tool results:' }, ...images],
    });
    images = [];
  };
  for (const message of messages) {
    if (message.role !== 'tool') {
      flush();
      moved.push(message);
      continue;
    }
    moved.push({
      ...message,
      content: message.content.map((part) => moveResultImages(part, images)),
    });
  }
  flush();
  return moved;
}

/**
 * `part` with its `image-data` items appended to `images` and replaced by one
 * `(image attached below)` line after its other items; a part without one is
 * returned as is.
 */
function moveResultImages(
  part: ToolMessagePart,
  images: Array<UserContentPart>,
): ToolMessagePart {
  if (part.type !== 'tool-result' || part.output.type !== 'content') {
    return part;
  }
  const value = part.output.value;
  const kept = value.filter((item) => item.type !== 'image-data');
  if (kept.length === value.length) return part;
  for (const item of value) {
    if (item.type !== 'image-data') continue;
    images.push({ type: 'image', image: item.data, mediaType: item.mediaType });
  }
  kept.push({ type: 'text', text: '(image attached below)' });
  return { ...part, output: toolOutput(kept) };
}

/**
 * `messages` as the composer projects them under `sizing` (see `mapMediaRefs`
 * for the placement). Each reference takes one form, in this order: the
 * unavailable placeholder for an unresolvable `media://` reference; the
 * omitted one on a text-only model; the not-retained one for an unstored
 * image the attempt holds no entry for; `attach(image)` when the window
 * attaches it; and the limit one otherwise. With `sizing.moveToolImages`,
 * tool-result images then move out of the tool messages (see
 * `moveToolResultImages`). `sizing.statuses` is aligned to the end of
 * `messages`' references, so a continuation's trailing rows project
 * with the whole request's admission.
 */
export function projectMediaRefs(
  messages: Array<ModelMessage>,
  sizing: MediaSizing,
  attach: (image: AttachedImage) => Array<ProjectedMedia>,
): Array<ModelMessage> {
  const offset = sizing.statuses.length - collectMediaRefs(messages).length;
  const project = (
    { subject, attached }: ResolvedImage,
    status: MediaAdmission | undefined,
  ): Array<ProjectedMedia> => {
    if (!sizing.imageInput) return textOf(omittedPlaceholder(subject));
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
  const projected = mapMediaRefs(messages, (ref, index) => {
    const status = sizing.statuses[offset + index];
    if (!isString(ref)) {
      return project(unstoredImage(ref, sizing.held), status);
    }
    const descriptor = sizing.descriptors.get(ref);
    return descriptor === undefined
      ? textOf(unavailablePlaceholder(ref))
      : project(storedImage(ref, descriptor), status);
  });
  return sizing.moveToolImages ? moveToolResultImages(projected) : projected;
}

/** The bytes a sized projection gives each attached image (see `projectSizedText`). */
const UNSIZED = new Uint8Array(0);

/**
 * `messages` as the composer sends them under `sizing` (see
 * `projectMediaRefs`), with every attached image passed to `charge` and then
 * left out: the text an estimate counts, including the lines a wire that
 * moves tool-result images adds, while the image itself is charged by its
 * dimensions (vision-media D6).
 */
export function projectSizedText(
  messages: Array<ModelMessage>,
  sizing: MediaSizing,
  charge: (image: AttachedImage) => void,
): Array<ModelMessage> {
  const projected = projectMediaRefs(messages, sizing, (image) => {
    charge(image);
    return [{ type: 'image', image: UNSIZED, mediaType: image.modelMediaType }];
  });
  // An attached image is UNSIZED in a user message and, as `image-data`,
  // empty base64 in a tool output or once moved out of one.
  return projected.map((message): ModelMessage => {
    if (message.role === 'tool') {
      return { ...message, content: message.content.map(withoutSizedImages) };
    }
    if (message.role !== 'user' || !Array.isArray(message.content)) {
      return message;
    }
    return {
      ...message,
      content: message.content.filter(
        (part) =>
          part.type !== 'image' ||
          (part.image !== UNSIZED && part.image !== ''),
      ),
    };
  });
}

/**
 * `part` without the empty `image-data` items `projectSizedText` attaches;
 * a result left with text alone is sized as a text output (see `toolOutput`).
 */
function withoutSizedImages(part: ToolMessagePart): ToolMessagePart {
  if (part.type !== 'tool-result' || part.output.type !== 'content') {
    return part;
  }
  const value = part.output.value.filter(
    (item) => item.type !== 'image-data' || item.data !== '',
  );
  return value.length === part.output.value.length
    ? part
    : { ...part, output: toolOutput(value) };
}

/** A placeholder as a reference's projection. */
function textOf(text: string): Array<ProjectedMedia> {
  return [{ type: 'text', text }];
}

function storedImage(id: string, d: MediaDescriptor): ResolvedImage {
  return {
    subject: storedSubject(d),
    attached: {
      modelWidth: d.modelWidth,
      modelHeight: d.modelHeight,
      modelMediaType: d.modelMediaType,
      source: { id },
    },
  };
}

/** An unstored image, attachable only while the attempt retains its variant. */
function unstoredImage(
  ref: UnstoredRef,
  held: ReadonlyMap<string, HeldImage>,
): ResolvedImage {
  const subject = unstoredSubject(ref);
  const model = held.get(ref.key)?.model;
  return model === undefined
    ? { subject }
    : {
        subject,
        attached: {
          modelWidth: model.width,
          modelHeight: model.height,
          modelMediaType: model.mediaType,
          source: { bytes: model.bytes },
        },
      };
}

/**
 * Replace each media reference of `messages`, in request order, with
 * `project(ref, index)`, where `index` is the reference's position among all
 * of `messages`' references. A user message's `media://` file part is
 * preceded by its label `Image n (media://<id>):` (n counting that message's
 * references from 1). A tool result's image reference is projected in place
 * after the result's text, an image becoming `image-data`; a result left with
 * text alone becomes a text output of those texts joined by newlines.
 * Messages without references are returned as the same objects.
 */
export function mapMediaRefs(
  messages: Array<ModelMessage>,
  project: (ref: MediaRef, index: number) => Array<ProjectedMedia>,
): Array<ModelMessage> {
  let index = 0;
  const next: NextRef = (ref) => {
    index += 1;
    return project(ref, index - 1);
  };
  return messages.map((message) => {
    if (message.role === 'tool') {
      const content = message.content.map((part) =>
        mapToolResultRefs(part, next),
      );
      return content.every((part, at) => part === message.content[at])
        ? message
        : { ...message, content };
    }
    if (message.role !== 'user' || !Array.isArray(message.content)) {
      return message;
    }
    let label = 0;
    const content = message.content.flatMap((part): Array<UserContentPart> => {
      const id = part.type === 'file' ? fileMediaRef(part) : undefined;
      if (id === undefined) return [part];
      label += 1;
      return [
        { type: 'text', text: `Image ${label} (${mediaLocator(id)}):` },
        ...next(id),
      ];
    });
    return label === 0 ? message : { ...message, content };
  });
}

type NextRef = (ref: MediaRef) => Array<ProjectedMedia>;
type ToolMessagePart = Extract<
  ModelMessage,
  { role: 'tool' }
>['content'][number];

/**
 * A tool result with each image reference projected in place by `next` (see
 * `mapMediaRefs`); a part without one is returned as is.
 */
function mapToolResultRefs(
  part: ToolMessagePart,
  next: NextRef,
): ToolMessagePart {
  if (part.type !== 'tool-result' || part.output.type !== 'content') {
    return part;
  }
  const items = part.output.value;
  const refs = items.map((item) => toolItemRef(item, part.toolCallId));
  if (refs.every((ref) => ref === undefined)) return part;
  const value = items.flatMap((item, at): Array<ToolContentPart> => {
    const image = refs[at];
    if (image === undefined) return [item];
    return next(image).map((projected) =>
      projected.type === 'text'
        ? projected
        : {
            type: 'image-data',
            data: Buffer.from(projected.image).toString('base64'),
            mediaType: projected.mediaType,
          },
    );
  });
  return { ...part, output: toolOutput(value) };
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
 * `input.media` the composer is the identity. `moveToolImages` is set by the
 * Chat Completions wires (see `ComposeStepOptions`).
 */
export function installStepPreparation(
  streamOptions: Parameters<typeof streamText>[0],
  input: ModelStreamInput,
  modelInput: ReadonlyArray<ModelInput> | undefined,
  { moveToolImages = false }: { moveToolImages?: boolean } = {},
): void {
  const tools = input.tools !== undefined;
  // `null` and absent both mean "no cap" (design D1).
  const cap = input.maxSteps ?? undefined;
  const media = input.media;
  const imageInput = modelInput?.includes('image') ?? false;
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
      media === undefined
        ? override
        : await composeStepMessages(override ?? messages, {
            resolver: media,
            imageInput,
            moveToolImages,
          });
    return {
      ...(composed && { messages: composed }),
      ...(capReached && { activeTools: [] }),
    };
  };
}
