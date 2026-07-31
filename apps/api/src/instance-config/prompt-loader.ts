import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import Handlebars from 'handlebars';

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

/**
 * Prompt templates render through their own Handlebars environment so that no
 * helper or partial registered anywhere else in the process is reachable from a
 * prompt file.
 *
 * `Handlebars.create()` shares `Utils` **by reference** with the global export,
 * so `Utils.escapeExpression` MUST NOT be replaced here — patching it would
 * change escaping for every other handlebars consumer in the process. Values
 * are escaped when the context is built instead (`escapeForPrompt`).
 */
const templates = Handlebars.create();

/**
 * Context paths a prompt file may reference. Later capabilities extend this
 * list rather than editing the validator (`add-user-personalization` adds the
 * per-user paths here).
 */
export const PROMPT_CONTEXT_PATHS: readonly string[] = [
  'model.id',
  'model.name',
];

/**
 * Node kinds a prompt template may contain. An allowlist rather than a list of
 * known-bad forms: it is simpler, and it needs no revisiting when handlebars
 * adds a node kind. Partials in particular exist in three syntactic forms
 * (`PartialStatement`, `PartialBlockStatement`, and an inline partial defined
 * through a `DecoratorBlock`) which a blocklist would have to name one by one —
 * they stay rejected because `model-system-prompts` forbids composing a prompt
 * from fragments.
 */
const ALLOWED_NODE_TYPES: ReadonlySet<string> = new Set([
  'ContentStatement',
  'MustacheStatement',
  'BlockStatement',
  'CommentStatement',
]);

/** Conditionals only. `else` needs no entry: it is the `inverse` of its block. */
const ALLOWED_BLOCK_HELPERS: ReadonlySet<string> = new Set(['if', 'unless']);

/**
 * Pre-cutover interpolation, rejected so a partial migration fails loudly.
 * Scoped to the namespaces the old grammar recognized (`model`) or explicitly
 * rejected (`config`, `env`) rather than every `${...}`, so a prompt that
 * legitimately discusses shell or template syntax in prose still loads.
 */
const LEGACY_EXPRESSION_PATTERN = /\$\$?\{(?:model|config|env)\b/u;

const PROMPT_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

/**
 * Escapes exactly the characters that could introduce markup into a rendered
 * prompt. Deliberately narrower than handlebars' default, which also converts
 * `'`, `"`, `=`, and backticks into character references and would mangle both
 * prose and code fragments on every request.
 */
export function escapeForPrompt(value: string): string {
  return value.replace(/[&<>]/gu, (character) => PROMPT_ESCAPES[character]);
}

/**
 * Projects one value into the render context, or omits it.
 *
 * Omission is required rather than cosmetic: a `SafeString` is an object and so
 * is truthy **even when it wraps an empty string**, which would make every
 * `{{#if}}` over it evaluate true. A whitespace-only value is truthy too, hence
 * the trim.
 */
function promptValue(
  raw: string | undefined,
): Handlebars.SafeString | undefined {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  return new templates.SafeString(escapeForPrompt(trimmed));
}

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
  const compiledFiles = new Map<string, HandlebarsTemplateDelegate>();

  function loadPromptFile(
    filePath: string,
    field: string,
  ): HandlebarsTemplateDelegate {
    const resolvedPath = path.resolve(filePath);
    const cached = compiledFiles.get(resolvedPath);
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
    assertSupportedTemplate(normalized, field);
    // Compiled once per file: several models may share one systemPromptFile,
    // and the template was already parsed for validation just above.
    const compiled = templates.compile(normalized);
    compiledFiles.set(resolvedPath, compiled);
    return compiled;
  }

  function loadProjectDefault(field: string): HandlebarsTemplateDelegate {
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
      const template = hasOverride
        ? loadPromptFile(promptPath, field)
        : loadProjectDefault(field);
      const systemPrompt = renderPrompt(template, model, field);

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

function unsupported(field: string, construct: string): InstanceConfigError {
  return new InstanceConfigError(
    `${field}: unsupported prompt construct "${construct}"`,
  );
}

function assertPath(node: hbs.AST.Expression, field: string): void {
  if (node.type !== 'PathExpression') {
    throw unsupported(field, node.type);
  }
  const original = String((node as hbs.AST.PathExpression).original);
  if (!PROMPT_CONTEXT_PATHS.includes(original)) {
    throw unsupported(field, `{{${original}}}`);
  }
}

function assertStatements(
  body: readonly hbs.AST.Statement[],
  field: string,
): void {
  for (const node of body) {
    if (!ALLOWED_NODE_TYPES.has(node.type)) {
      throw unsupported(field, node.type);
    }

    if (node.type === 'MustacheStatement') {
      const mustache = node as hbs.AST.MustacheStatement;
      if (!mustache.escaped) {
        throw unsupported(field, 'unescaped output');
      }
      // A parameterized value expression is a helper invocation; this also
      // covers subexpressions, which parse as a parameter.
      if (mustache.params.length > 0 || mustache.hash !== undefined) {
        throw unsupported(field, 'helper invocation');
      }
      assertPath(mustache.path, field);
      continue;
    }

    if (node.type === 'BlockStatement') {
      const block = node as hbs.AST.BlockStatement;
      const helper = block.path.original;
      if (typeof helper !== 'string' || !ALLOWED_BLOCK_HELPERS.has(helper)) {
        throw unsupported(field, String(helper));
      }
      for (const param of block.params) {
        assertPath(param, field);
      }
      // A hash argument can carry a SubExpression, which is a helper
      // invocation the params check alone would not see.
      if (block.hash !== undefined) {
        throw unsupported(field, 'helper invocation');
      }
      assertStatements(block.program?.body ?? [], field);
      assertStatements(block.inverse?.body ?? [], field);
    }
  }
}

/**
 * Boot-time validation, performed against the **template** rather than any
 * rendered output: a template whose content is only expressions and whitespace
 * must fail here rather than pass and render empty once a value is absent.
 */
/**
 * Whether any literal text exists anywhere in the template, including inside
 * conditional bodies — a prompt may legitimately consist of nothing but an
 * `{{#if}}` block wrapping its only prose.
 */
function hasLiteralContent(body: readonly hbs.AST.Statement[]): boolean {
  return body.some((node) => {
    if (node.type === 'ContentStatement') {
      return (node as hbs.AST.ContentStatement).value.trim().length > 0;
    }
    if (node.type === 'BlockStatement') {
      const block = node as hbs.AST.BlockStatement;
      return (
        hasLiteralContent(block.program?.body ?? []) ||
        hasLiteralContent(block.inverse?.body ?? [])
      );
    }
    return false;
  });
}

function assertSupportedTemplate(prompt: string, field: string): void {
  if (LEGACY_EXPRESSION_PATTERN.test(prompt)) {
    throw unsupported(field, 'legacy ${model.*} interpolation');
  }

  let ast: hbs.AST.Program;
  try {
    ast = templates.parse(prompt);
  } catch {
    throw new InstanceConfigError(`${field}: prompt template failed to parse`);
  }

  assertStatements(ast.body, field);

  if (!hasLiteralContent(ast.body)) {
    throw new InstanceConfigError(`${field}: prompt file is empty`);
  }
}

function renderPrompt(
  template: HandlebarsTemplateDelegate,
  model: Pick<PromptModel, 'id' | 'name'>,
  field: string,
): string {
  // An allowlisted path with no value renders empty rather than failing. The
  // pre-cutover grammar failed startup here, which only made sense while
  // absence was inexpressible: `{{#if model.name}}...{{model.name}}...{{/if}}`
  // is the idiom conditionals exist for, and a fail-on-reference rule would
  // reject it. Typos still fail loudly: an unknown path is rejected in
  // `assertSupportedTemplate`.
  const context = {
    model: {
      id: promptValue(model.id),
      name: promptValue(model.name),
    },
  };

  const rendered = template(context);
  if (rendered.trim().length === 0) {
    throw new InstanceConfigError(`${field}: rendered prompt is empty`);
  }
  return rendered;
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
