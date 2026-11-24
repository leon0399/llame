import { Injectable } from '@nestjs/common';

import {
  type PromptWebSearchInput,
  type RenderedPrompt,
  type TemporalAnchor,
  renderSystemPromptTemplate,
} from '../instance-config/prompt-loader';
import {
  type PromptSkillsInput,
  type PromptUserInput,
  type SystemModelCatalogEntry,
} from '../models/model-catalog';

/** Everything rendering needs from a catalog entry — all of it plain data. */
export type RenderableModel = Pick<
  SystemModelCatalogEntry,
  'id' | 'name' | 'systemPromptTemplate'
>;

export type SystemPromptRenderInput = {
  model: RenderableModel;
  anchor: TemporalAnchor;
  user?: PromptUserInput;
  /** The frozen skill-catalog baseline; absent renders no catalog section. */
  skills?: PromptSkillsInput;
  /** The boot-resolved engine list; absent renders no engine list. */
  webSearch?: PromptWebSearchInput;
  admittedToolIds?: ReadonlyArray<string>;
};

/** Renders one complete system prompt from explicit renderable values. */
@Injectable()
export class SystemPromptsService {
  render(input: SystemPromptRenderInput): RenderedPrompt {
    return renderSystemPromptTemplate({
      template: input.model.systemPromptTemplate,
      model: input.model,
      anchor: input.anchor,
      user: input.user,
      skills: input.skills,
      webSearch: input.webSearch,
      admittedToolIds: input.admittedToolIds,
    });
  }
}
