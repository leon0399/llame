import { Injectable } from '@nestjs/common';

import {
  type PromptUserInput,
  renderSystemPromptTemplate,
} from '../instance-config/prompt-loader';
import { type SystemModelCatalogEntry } from '../models/model-catalog';

/** Everything rendering needs from a catalog entry — all of it plain data. */
export type RenderableModel = Pick<
  SystemModelCatalogEntry,
  'id' | 'name' | 'systemPromptTemplate'
>;

/**
 * Renders a model's complete system prompt for one run.
 *
 * Deliberately its own service rather than a method on `ModelsService`:
 * `model-system-prompts` is its own capability, and `ModelsService` answers a
 * different question (which model, which credentials, which client). Rendering
 * also takes the owner's personalization projection, which has no business
 * being reachable from a model-routing service.
 *
 * **The interface is narrow on purpose.** It is synchronous, takes one
 * template, and returns one string. `model-system-prompts` requires that each
 * model resolve exactly ONE complete prompt, with no inheritance or
 * composition — so there is no pipeline here to hang later context off. If this
 * ever grows an `await`, a chat id, or a second template, that is the signal
 * someone is building prompt composition, which the capability forbids.
 *
 * Volatile per-run context (recalled chats, retrieved knowledge) does NOT
 * belong here even when it arrives: it goes on the typed server-authored parts
 * rail immediately before the user turn, which keeps the system prompt and the
 * whole history inside the provider's cached prefix. See
 * `docs/research/long-term-memory/2026-07-27-user-context-injection.md`.
 */
@Injectable()
export class SystemPromptsService {
  render(model: RenderableModel, user?: PromptUserInput): string {
    return renderSystemPromptTemplate(model.systemPromptTemplate, model, user);
  }
}
