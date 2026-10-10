import type { ModelMessage, streamText, UserContent } from 'ai';

import {
  collectMediaRefs,
  fileMediaRef,
  loadMediaSizing,
  type MediaSizing,
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
};

export type UserContentPart = Exclude<UserContent, string>[number];

/**
 * The one place media references become what a model sees (vision-media D6).
 * Within each user message, its `media://` file parts are numbered from 1 and
 * each becomes the label `Image n (media://<id>):` followed by: the model
 * variant as an image part when the model declares `image` and the epoch window
 * attaches it; the limit placeholder when the window does not; the omitted
 * placeholder for any resolvable image on a text-only model; the unavailable
 * placeholder when the owner's store cannot resolve it. Only attached images'
 * bytes are loaded.
 *
 * Idempotent: the output carries no references, and messages without any are
 * returned as the same objects.
 */
export async function composeStepMessages(
  messages: Array<ModelMessage>,
  { resolver, imageInput }: ComposeStepOptions,
): Promise<Array<ModelMessage>> {
  const sizing = await loadMediaSizing(messages, resolver, imageInput);
  if (sizing.refs.length === 0) return messages;

  // One owner-scoped read for the step's attached images; the resolver caches
  // loaded bytes, so later steps read only images not loaded yet.
  const attached = imageInput
    ? [
        ...new Set(
          sizing.refs.filter(
            (_id, index) => sizing.statuses[index] === 'attached',
          ),
        ),
      ]
    : [];
  const bytes =
    attached.length === 0
      ? new Map<string, Uint8Array>()
      : await resolver.loadModelBytes(attached);

  return projectMediaRefs(messages, sizing, (id, descriptor) => {
    const image = bytes.get(id);
    // A descriptor whose blob cannot be read is as unresolvable as a missing one.
    return image === undefined
      ? [{ type: 'text', text: unavailablePlaceholder(id) }]
      : [{ type: 'image', image, mediaType: descriptor.modelMediaType }];
  });
}

/**
 * `messages` as the composer projects them under `sizing` (see `mapMediaRefs`
 * for the labels): each reference becomes the unavailable placeholder when
 * unresolvable, the omitted one on a text-only model, the limit one when the
 * window does not attach it, and `attach(id, descriptor)` otherwise.
 * `sizing.statuses` is aligned to the end of `messages`' references, so a
 * continuation's trailing rows project with the whole request's admission.
 */
export function projectMediaRefs(
  messages: Array<ModelMessage>,
  sizing: MediaSizing,
  attach: (id: string, descriptor: MediaDescriptor) => Array<UserContentPart>,
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

/**
 * Replace each `media://` file part of each user message, in request order,
 * with its label `Image n (media://<id>):` (n counting that message's
 * references from 1) followed by `project(id, index)`, where `index` is the
 * reference's position among all of `messages`' references. Messages without
 * references are returned as the same objects.
 */
export function mapMediaRefs(
  messages: Array<ModelMessage>,
  project: (id: string, index: number) => Array<UserContentPart>,
): Array<ModelMessage> {
  let index = 0;
  return messages.map((message) => {
    if (message.role !== 'user' || !Array.isArray(message.content)) {
      return message;
    }
    let label = 0;
    const content = message.content.flatMap((part): Array<UserContentPart> => {
      const id = part.type === 'file' ? fileMediaRef(part) : undefined;
      if (id === undefined) return [part];
      label += 1;
      index += 1;
      return [
        { type: 'text', text: `Image ${label} (${mediaLocator(id)}):` },
        ...project(id, index - 1),
      ];
    });
    return label === 0 ? message : { ...message, content };
  });
}

/**
 * The step preparation every `ModelClient` installs, with or without tools:
 * `ai` awaits `prepareStep` on every step either way, and the composer must
 * run on every request so no `media://` reference reaches a provider adapter.
 *
 * Only `onStepStart` and the step cap are tool-loop concerns and stay gated on
 * `input.tools`. The composer runs last, on the final messages, so the in-Run
 * splice records its prefix index on untransformed messages. Without
 * `input.media` the composer is the identity.
 */
export function installStepPreparation(
  streamOptions: Parameters<typeof streamText>[0],
  input: ModelStreamInput,
  modelInput: ReadonlyArray<ModelInput> | undefined,
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
          });
    return {
      ...(composed && { messages: composed }),
      ...(capReached && { activeTools: [] }),
    };
  };
}
