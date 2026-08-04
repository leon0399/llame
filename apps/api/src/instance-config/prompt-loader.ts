import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import Handlebars from 'handlebars';

import { sanitizeAuthoredText } from './authored-text';
import { InstanceConfigError } from './instance-config.error';
import type {
  PromptUserInput,
  SystemPromptSource,
} from '../models/model-catalog';
export type { PromptUserInput } from '../models/model-catalog';

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
  // Per-user paths (add-user-personalization). Validated at boot exactly like
  // any other identifier, but their VALUES resolve per run — no owner is in
  // scope at startup. Names match the API field names exactly so the prompt
  // vocabulary and the API contract cannot drift apart. Neither toggle is
  // renderable: they control whether these appear, and are not content.
  'user.personalization.preferredName',
  'user.personalization.about',
  'user.personalization.responsePreferences',
  'user.name',
  'user.email',
];

/**
 * Keyed on parsed segments, not the display string: `{{[model.id]}}` reports an
 * allowlisted `original` of `model.id` while parsing to a *single* literal
 * segment, so it would look up a property that does not exist and silently
 * render empty. `\0` joins because a `.` join would let the two collide.
 */
const toContextKey = (contextPath: string) => contextPath.split('.').join('\0');

const PROMPT_CONTEXT_KEYS: ReadonlySet<string> = new Set(
  PROMPT_CONTEXT_PATHS.map(toContextKey),
);

/**
 * Paths valid ONLY as a conditional's subject — `{{#if user}}` — and never as
 * output. They name the projection's intermediate objects, which exist so an
 * operator can gate a whole section (framing prose included) on whether the
 * owner has any per-user context at all, without repeating a condition per
 * field.
 *
 * Kept out of `PROMPT_CONTEXT_PATHS` deliberately: emitting one would render a
 * stringified object, which is never what an author meant. Splitting by
 * POSITION rather than adding them to the value allowlist means `{{user}}`
 * still fails boot with the same message as any other unsupported construct.
 */
const PROMPT_GATE_KEYS: ReadonlySet<string> = new Set(
  ['user', 'user.personalization'].map(toContextKey),
);

/**
 * Allowlist, not a blocklist: needs no revisiting when handlebars adds a node
 * kind, and partials — forbidden by `model-system-prompts` — have three
 * spellings a blocklist would have to name one by one.
 */
const ALLOWED_NODE_TYPES: ReadonlySet<string> = new Set([
  'ContentStatement',
  'MustacheStatement',
  'BlockStatement',
  'CommentStatement',
]);

/** Conditionals only. `else` needs no entry: it is the `inverse` of its block. */
const ALLOWED_BLOCK_HELPERS: ReadonlySet<string> = new Set(['if', 'unless']);

/** Narrower than handlebars' default, which also mangles `'`, `"`, `=`, and backticks. */
const PROMPT_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

function escapeForPrompt(value: string): string {
  return value.replace(/[&<>]/gu, (character) => PROMPT_ESCAPES[character]);
}

/**
 * Projects one value into the render context, or omits it.
 *
 * Omission is required rather than cosmetic: a `SafeString` is an object and so
 * is truthy **even when it wraps an empty string**, which would make every
 * `{{#if}}` over it evaluate true. A whitespace-only value is truthy too, hence
 * the trim.
 *
 * `neutralize` is a parameter rather than a second copy of this function
 * because the omission rule must be identical for every field kind — only the
 * transform differs. Model and account-identity values take the strict `&<>`
 * escape, being short single-line strings with no legitimate markup. The
 * owner's AUTHORED fields are multi-paragraph documents they legitimately
 * structure with tags of their own, which that escape would entity-mangle, so
 * they take `sanitizeAuthoredText` instead — whose rules are what keep the
 * template's fence unforgeable.
 */
function promptValue(
  raw: string | undefined,
  neutralize: (value: string) => string = escapeForPrompt,
): Handlebars.SafeString | undefined {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  return new templates.SafeString(neutralize(trimmed));
}

/**
 * Compiled templates, keyed by their SOURCE rather than by file path.
 *
 * The catalog carries prompt templates as plain strings, so compilation has to
 * happen on the render path; doing it per run would re-parse the template on
 * every message. Keying on source means several models pointing at one file
 * share a compile, and it stays correct when the same text arrives from
 * somewhere else entirely (a test fixture, say).
 *
 * Bounded by the number of distinct prompt files in the operator's config,
 * which is config-as-code read once at boot — not an unbounded cache over user
 * input.
 */
const compiledTemplates = new Map<string, HandlebarsTemplateDelegate>();

function compileTemplate(template: string): HandlebarsTemplateDelegate {
  const cached = compiledTemplates.get(template);
  if (cached !== undefined) {
    return cached;
  }
  const compiled = templates.compile(template);
  compiledTemplates.set(template, compiled);
  return compiled;
}

/**
 * Renders one model's complete system prompt.
 *
 * Lives here rather than in the service that exposes it because the render
 * context is built with `templates.SafeString`, and a value must come from the
 * SAME created Handlebars environment that renders it or the engine escapes it
 * a second time. `SystemPromptsService` is the injectable wrapper over this.
 */
export function renderSystemPromptTemplate(
  template: string,
  model: Pick<PromptModel, 'id' | 'name'>,
  user?: PromptUserInput,
): string {
  return renderPrompt(compileTemplate(template), model, user);
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
    systemPromptTemplate: string;
    systemPromptSource: SystemPromptSource;
  };
  validateProjectDefault(): void;
} {
  const access = options.access ?? DEFAULT_PROMPT_FILE_ACCESS;
  const defaultPromptPath = path.resolve(
    options.defaultPromptPath ?? DEFAULT_CHAT_SYSTEM_PROMPT_PATH,
  );
  const configDirectory = path.dirname(options.configPath);
  const loadedFiles = new Map<string, string>();

  function loadPromptFile(filePath: string, field: string): string {
    const resolvedPath = path.resolve(filePath);
    const cached = loadedFiles.get(resolvedPath);
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
    // Read and validated once per file: several models may share one
    // systemPromptFile. Compilation is NOT done here — the catalog carries the
    // template as a string, and `renderSystemPromptTemplate` compiles once per
    // distinct source on the render path.
    loadedFiles.set(resolvedPath, normalized);
    return normalized;
  }

  return {
    resolve(model) {
      const field = `models[${model.id}].systemPromptFile`;
      const override = model.systemPromptFile;
      // `path.resolve` returns an absolute second argument unchanged.
      const promptPath =
        override === undefined
          ? defaultPromptPath
          : path.resolve(configDirectory, override);
      const systemPromptTemplate = loadPromptFile(promptPath, field);

      // Boot-time probe, not the real render: per-user values resolve per run,
      // so this renders with the model context alone and again with a populated
      // owner. BOTH are required, and the second is not belt-and-braces.
      //
      // It is tempting to argue that one probe suffices because per-user
      // context "only ever adds content" — but `unless` is an allowed helper
      // and `user` is a legal gate subject, so `{{#unless user}}` INVERTS that.
      // A template whose only content sits there renders fine with no owner and
      // empty for precisely the owners who did personalize. Probing one gate
      // state would pass it at boot and fail in production for exactly the
      // people the feature exists for.
      //
      // So a template whose whole content sits inside `{{#if user}}` OR inside
      // `{{#unless user}}` fails startup, rather than shipping a prompt that is
      // empty for half the users.
      const probes: readonly (PromptUserInput | undefined)[] = [
        undefined,
        { preferredName: 'probe' },
      ];
      if (
        probes.some(
          (probe) =>
            renderSystemPromptTemplate(
              systemPromptTemplate,
              model,
              probe,
            ).trim().length === 0,
        )
      ) {
        throw new InstanceConfigError(`${field}: rendered prompt is empty`);
      }

      return {
        // The catalog carries the TEMPLATE, not a rendered string and not a
        // closure over one: per-user values resolve per run, and rendering is
        // `SystemPromptsService`'s job. Keeping the entry plain data is what
        // lets it stay serializable and lets a fixture be an object literal.
        systemPromptTemplate,
        systemPromptSource:
          override === undefined ? 'project_default' : 'model_override',
      };
    },

    validateProjectDefault() {
      loadPromptFile(defaultPromptPath, 'project default system prompt asset');
    },
  };
}

function unsupported(field: string, construct: string): InstanceConfigError {
  return new InstanceConfigError(
    `${field}: unsupported prompt construct "${construct}"`,
  );
}

function assertPath(
  node: hbs.AST.Expression,
  field: string,
  position: 'value' | 'conditional' = 'value',
): void {
  if (node.type !== 'PathExpression') {
    throw unsupported(field, node.type);
  }
  const expression = node as hbs.AST.PathExpression;
  const key = expression.parts.join('\0');
  const permitted =
    PROMPT_CONTEXT_KEYS.has(key) ||
    (position === 'conditional' && PROMPT_GATE_KEYS.has(key));
  // `depth > 0` is `../`, which climbs out of the projected context.
  if (expression.depth > 0 || !permitted) {
    throw unsupported(field, `{{${String(expression.original)}}}`);
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
      // Arity is validated here rather than left to the engine: handlebars
      // throws a bare Error at *render* time for a malformed conditional,
      // which would escape as an unwrapped failure naming neither the model
      // nor the field.
      if (block.params.length !== 1) {
        throw unsupported(
          field,
          `{{#${helper}}} with ${block.params.length} arguments`,
        );
      }
      assertPath(block.params[0], field, 'conditional');
      // A hash argument can carry a SubExpression, which is a helper
      // invocation the params check alone would not see.
      if (block.hash !== undefined) {
        throw unsupported(field, 'helper invocation');
      }
      // `as |x|` binds a name that is outside the projected context.
      if (
        (block.program?.blockParams?.length ?? 0) > 0 ||
        (block.inverse?.blockParams?.length ?? 0) > 0
      ) {
        throw unsupported(field, 'block parameters');
      }
      assertStatements(block.program?.body ?? [], field);
      assertStatements(block.inverse?.body ?? [], field);
    }
  }
}

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

/**
 * Projects per-user values into the render context, omitting at THREE levels:
 * an individual field with no value, `user.personalization` when no authored
 * field survives, and `user` itself when nothing beneath it would render.
 *
 * The third level is what lets an operator gate a whole section — framing prose
 * included — on a single `{{#if user}}`. Without it, an owner who shares only
 * their account identity would lose it to a `user.personalization` gate, while
 * gating on nothing at all would render framing prose around an empty block.
 */
function userContext(user: PromptUserInput | undefined) {
  if (user === undefined) {
    return undefined;
  }

  const authored = {
    preferredName: promptValue(
      user.preferredName ?? undefined,
      sanitizeAuthoredText,
    ),
    about: promptValue(user.about ?? undefined, sanitizeAuthoredText),
    responsePreferences: promptValue(
      user.responsePreferences ?? undefined,
      sanitizeAuthoredText,
    ),
  };
  const name = promptValue(user.name ?? undefined);
  const email = promptValue(user.email ?? undefined);

  const hasAuthored = Object.values(authored).some(
    (value) => value !== undefined,
  );
  const context = {
    ...(hasAuthored ? { personalization: authored } : {}),
    ...(name === undefined ? {} : { name }),
    ...(email === undefined ? {} : { email }),
  };

  return Object.keys(context).length === 0 ? undefined : context;
}

function renderPrompt(
  template: HandlebarsTemplateDelegate,
  model: Pick<PromptModel, 'id' | 'name'>,
  user: PromptUserInput | undefined,
): string {
  // An allowlisted path with no value renders empty rather than failing, so
  // that `{{#if model.name}}...{{model.name}}...{{/if}}` is expressible. Typos
  // still fail loudly: an unknown path is rejected in
  // `assertSupportedTemplate`.
  const projected = userContext(user);
  const context = {
    model: {
      id: promptValue(model.id),
      name: promptValue(model.name),
    },
    ...(projected === undefined ? {} : { user: projected }),
  };

  return template(context);
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
