import type { ModelMessage, streamText, UserContent } from 'ai';

import {
  collectMediaRefs,
  fileMediaRef,
  imageMediaRef,
  loadMediaSizing,
  toolOutputMediaRef,
  type MediaSizing,
  type ToolContentPart,
  type ToolResultOutput,
} from '../media/epoch-admission';
import {
  limitPlaceholder,
  omittedPlaceholder,
  unavailablePlaceholder,
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
 * The one place media references become what a model sees (vision-media D6).
 * Within each user message, its `media://` file parts are numbered from 1 and
 * each becomes the label `Image n (media://<id>):` followed by its projection;
 * a tool result's image reference becomes its projection after the result's
 * text. The projection is the model variant as an image when the model
 * declares `image` and the epoch window attaches it; the limit placeholder
 * when the window does not; the omitted placeholder for any resolvable image
 * on a text-only model; the unavailable placeholder when the owner's store
 * cannot resolve it. With `moveToolImages`, tool-result images then move out
 * of the tool messages (see `moveToolResultImages`). Only the bytes of images
 * sent as images are loaded.
 *
 * Idempotent: the output carries no references, and a request without any is
 * returned as is; otherwise messages without any keep their identity, except
 * tool messages under `moveToolImages`.
 */
export async function composeStepMessages(
  messages: Array<ModelMessage>,
  { resolver, imageInput, moveToolImages = false }: ComposeStepOptions,
): Promise<Array<ModelMessage>> {
  const sizing = await loadMediaSizing(messages, resolver, imageInput);
  if (sizing.refs.length === 0) return messages;

  // One owner-scoped read for the step's sent images; the resolver caches
  // loaded bytes, so later steps read only images not loaded yet.
  const sent = imageInput
    ? [
        ...new Set(
          sizing.refs.filter(
            (_id, index) => sizing.statuses[index] === 'attached',
          ),
        ),
      ]
    : [];
  const bytes =
    sent.length === 0
      ? new Map<string, Uint8Array>()
      : await resolver.loadModelBytes(sent);

  const projected = projectMediaRefs(messages, sizing, (id, descriptor) => {
    const image = bytes.get(id);
    // A descriptor whose blob cannot be read is as unresolvable as a missing one.
    return image === undefined
      ? [{ type: 'text', text: unavailablePlaceholder(id) }]
      : [{ type: 'image', image, mediaType: descriptor.modelMediaType }];
  });
  return moveToolImages ? moveToolResultImages(projected) : projected;
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
 * for the placement): each reference becomes the unavailable placeholder when
 * unresolvable, the omitted one on a text-only model, the limit one when the
 * window does not attach it, and `attach(id, descriptor)` otherwise.
 * `sizing.statuses` is aligned to the end of `messages`' references, so a
 * continuation's trailing rows project with the whole request's admission.
 */
function projectMediaRefs(
  messages: Array<ModelMessage>,
  sizing: MediaSizing,
  attach: (id: string, descriptor: MediaDescriptor) => Array<ProjectedMedia>,
): Array<ModelMessage> {
  const offset = sizing.statuses.length - collectMediaRefs(messages).length;
  return mapMediaRefs(messages, (id, index) => {
    const descriptor = sizing.descriptors.get(id);
    if (descriptor === undefined) {
      return [{ type: 'text', text: unavailablePlaceholder(id) }];
    }
    if (!sizing.imageInput) {
      return [{ type: 'text', text: omittedPlaceholder(descriptor) }];
    }
    if (sizing.statuses[offset + index] !== 'attached') {
      return [{ type: 'text', text: limitPlaceholder(descriptor) }];
    }
    return attach(id, descriptor);
  });
}

/** The bytes a sized projection gives each attached image (see `projectSizedText`). */
const UNSIZED = new Uint8Array(0);

/**
 * `messages` as the composer projects them under `sizing` (see
 * `projectMediaRefs`), with tool-result images moved out of the tool messages
 * (see `moveToolResultImages`) and every attached image passed to `charge` and
 * then left out: the text an estimate counts, while the image itself is
 * charged by its dimensions (vision-media D6).
 *
 * The move is applied on every wire, though only the Chat Completions wires
 * send it: the estimate is then exact there and, elsewhere, an upper bound at
 * most a few tokens per tool-result image larger (the `(image attached
 * below)` line and the `Images from tool results:` message), so admission and
 * compaction need not know the client's wire.
 */
export function projectSizedText(
  messages: Array<ModelMessage>,
  sizing: MediaSizing,
  charge: (descriptor: MediaDescriptor) => void,
): Array<ModelMessage> {
  const projected = projectMediaRefs(messages, sizing, (_id, descriptor) => {
    charge(descriptor);
    return [
      { type: 'image', image: UNSIZED, mediaType: descriptor.modelMediaType },
    ];
  });
  // Once moved, an attached image is UNSIZED in a user message, or empty
  // base64 when it came from a tool output.
  return moveToolResultImages(projected).map((message): ModelMessage => {
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
 * Replace each media reference of `messages`, in request order, with
 * `project(id, index)`, where `index` is the reference's position among
 * all of `messages`' references. A user message's `media://` file part is
 * preceded by its label `Image n (media://<id>):` (n counting that message's
 * file references from 1); its `media://` image part (a prompt-import image)
 * is projected in place, unlabelled, right after the item's text. A tool
 * result's `image-url` reference is projected in place after the result's
 * text, an image becoming `image-data`; a result left with text alone becomes
 * a text output of those texts joined by newlines. Messages without
 * references are returned as the same objects.
 */
export function mapMediaRefs(
  messages: Array<ModelMessage>,
  project: (id: string, index: number) => Array<ProjectedMedia>,
): Array<ModelMessage> {
  let index = 0;
  const next: NextRef = (id) => {
    index += 1;
    return project(id, index - 1);
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
    const content = mapUserContentRefs(message.content, next);
    return content === undefined ? message : { ...message, content };
  });
}

type NextRef = (id: string) => Array<ProjectedMedia>;

/**
 * A user message's content with each reference projected by `next` (see
 * `mapMediaRefs`), or undefined when it holds none.
 */
function mapUserContentRefs(
  parts: Array<UserContentPart>,
  next: NextRef,
): Array<UserContentPart> | undefined {
  let label = 0;
  let mapped = false;
  const content = parts.flatMap((part): Array<UserContentPart> => {
    const imageId = part.type === 'image' ? imageMediaRef(part) : undefined;
    if (imageId !== undefined) {
      mapped = true;
      return next(imageId);
    }
    const id = part.type === 'file' ? fileMediaRef(part) : undefined;
    if (id === undefined) return [part];
    mapped = true;
    label += 1;
    return [
      { type: 'text', text: `Image ${label} (${mediaLocator(id)}):` },
      ...next(id),
    ];
  });
  return mapped ? content : undefined;
}

type ToolMessagePart = Extract<
  ModelMessage,
  { role: 'tool' }
>['content'][number];

/**
 * A tool result with each `image-url` media reference projected in place by
 * `next` (see `mapMediaRefs`); a part without one is returned as is.
 */
function mapToolResultRefs(
  part: ToolMessagePart,
  next: NextRef,
): ToolMessagePart {
  if (part.type !== 'tool-result' || part.output.type !== 'content') {
    return part;
  }
  const items = part.output.value;
  if (items.every((item) => toolOutputMediaRef(item) === undefined)) {
    return part;
  }
  const value = items.flatMap((item): Array<ToolContentPart> => {
    const id = toolOutputMediaRef(item);
    if (id === undefined) return [item];
    return next(id).map((projected) =>
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
