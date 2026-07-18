import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { InstanceConfigError } from './instance-config.error';
import type { SystemPromptSource } from '../models/model-catalog';

export type PromptFileAccess = {
  isFile(filePath: string): boolean;
  readFile(filePath: string): string;
};

type PromptModel = {
  id: string;
  name?: string;
  systemPromptFile?: string;
};

type ModelPromptLoaderOptions = {
  configPath: string;
  defaultPromptPath?: string;
  access?: PromptFileAccess;
};

const DEFAULT_PROMPT_FILE_ACCESS: PromptFileAccess = {
  isFile: (filePath) => statSync(filePath).isFile(),
  readFile: (filePath) => readFileSync(filePath, 'utf8'),
};

const PROMPT_EXPRESSION_PATTERN = /\$\$\{[^}]*\}|\$\{[^}]*\}/gu;

export function resolveDefaultChatSystemPromptPath(
  moduleDirectory: string,
): string {
  return path.resolve(moduleDirectory, '../prompts/chat-default.md');
}

export const DEFAULT_CHAT_SYSTEM_PROMPT_PATH =
  resolveDefaultChatSystemPromptPath(__dirname);

export function createModelPromptLoader(options: ModelPromptLoaderOptions): {
  resolve(model: PromptModel): {
    systemPrompt: string;
    systemPromptSource: SystemPromptSource;
  };
  validateProjectDefault(): void;
} {
  const access = options.access ?? DEFAULT_PROMPT_FILE_ACCESS;
  const defaultPromptPath = path.resolve(
    options.defaultPromptPath ?? DEFAULT_CHAT_SYSTEM_PROMPT_PATH,
  );
  const configDirectory = path.dirname(options.configPath);
  const normalizedFiles = new Map<string, string>();

  function loadPromptFile(filePath: string, field: string): string {
    const resolvedPath = path.resolve(filePath);
    const cached = normalizedFiles.get(resolvedPath);
    if (cached !== undefined) {
      return cached;
    }

    let isFile: boolean;
    try {
      isFile = access.isFile(resolvedPath);
    } catch (error) {
      throw promptReadError(field, error);
    }
    if (!isFile) {
      throw new InstanceConfigError(
        `${field}: prompt path must reference a regular file`,
      );
    }

    let raw: string;
    try {
      raw = access.readFile(resolvedPath);
    } catch (error) {
      throw promptReadError(field, error);
    }

    const normalized = raw.replace(/\r\n?/gu, '\n').replace(/\s+$/u, '');
    if (normalized.length === 0) {
      throw new InstanceConfigError(`${field}: prompt file is empty`);
    }
    assertSupportedPromptExpressions(normalized, field);
    normalizedFiles.set(resolvedPath, normalized);
    return normalized;
  }

  function loadProjectDefault(field: string): string {
    return loadPromptFile(defaultPromptPath, field);
  }

  return {
    resolve(model) {
      const field = `models[${model.id}].systemPromptFile`;
      const hasOverride = model.systemPromptFile !== undefined;
      const promptPath = hasOverride
        ? path.isAbsolute(model.systemPromptFile as string)
          ? (model.systemPromptFile as string)
          : path.resolve(configDirectory, model.systemPromptFile as string)
        : defaultPromptPath;
      const normalized = hasOverride
        ? loadPromptFile(promptPath, field)
        : loadProjectDefault(field);
      const systemPrompt = renderPrompt(normalized, model, field);

      return {
        systemPrompt,
        systemPromptSource: hasOverride ? 'model_override' : 'project_default',
      };
    },

    validateProjectDefault() {
      loadProjectDefault('project default system prompt asset');
    },
  };
}

function assertSupportedPromptExpressions(prompt: string, field: string): void {
  for (const match of prompt.matchAll(PROMPT_EXPRESSION_PATTERN)) {
    const expression = match[0];
    if (
      expression !== '${model.id}' &&
      expression !== '${model.name}' &&
      expression !== '$${model.name}'
    ) {
      throw new InstanceConfigError(
        `${field}: unsupported prompt variable "${expression}"`,
      );
    }
  }
}

function promptReadError(field: string, error: unknown): InstanceConfigError {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') {
    return new InstanceConfigError(`${field}: prompt file is missing`);
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new InstanceConfigError(`${field}: prompt file is unreadable`);
  }
  return new InstanceConfigError(`${field}: failed to read prompt file`);
}

function renderPrompt(
  prompt: string,
  model: Pick<PromptModel, 'id' | 'name'>,
  field: string,
): string {
  const rendered = prompt.replace(PROMPT_EXPRESSION_PATTERN, (expression) => {
    if (expression === '$${model.name}') {
      return '${model.name}';
    }
    if (expression === '${model.id}') {
      return model.id;
    }
    if (expression === '${model.name}') {
      if (model.name === undefined) {
        throw new InstanceConfigError(
          `${field}: prompt references unavailable variable "${expression}"`,
        );
      }
      return model.name;
    }
    throw new InstanceConfigError(
      `${field}: unsupported prompt variable "${expression}"`,
    );
  });

  if (rendered.trim().length === 0) {
    throw new InstanceConfigError(`${field}: rendered prompt is empty`);
  }
  return rendered;
}
