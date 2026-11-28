import path from 'node:path';

import { sanitizeAuthoredText } from './authored-text';
import { InstanceConfigError } from '@workspace/config-interpolation';
import { isString } from '@workspace/runtime-safety';
import {
  isToolPromptId,
  resolvePackagedToolDescriptionPath,
  TOOL_PROMPT_IDS,
  type ToolPromptId,
} from '../prompts/tool-descriptions';
import {
  compilePromptTemplate,
  DEFAULT_PROMPT_FILE_ACCESS,
  escapeForPrompt,
  parsePromptTemplate,
  promptSafeString,
  promptValue,
  readPromptSource,
  type PromptFileAccess,
  type PromptSafeValue,
} from '../prompts/template-engine';
import { parseMcpToolId } from '@workspace/mcp-workspace';
import { isToolId } from '../tools/tool-id';
import type {
  PromptSkillsInput,
  PromptUserInput,
  SystemPromptSource,
} from '../models/model-catalog';
import type { TemporalAnchor } from '../prompts/temporal-anchor';
import type { WebSearchEngineConfig } from './web-search-config';

export type { TemporalAnchor } from '../prompts/temporal-anchor';

export type { PromptFileAccess } from '../prompts/template-engine';

export type ToolPromptFileMap = Readonly<
  Record<string, string | null | undefined>
>;

export type PromptModel = {
  id: string;
  name?: string;
  systemPromptFile?: string;
  toolPromptFiles?: ToolPromptFileMap;
};

type ModelPromptLoaderOptions = {
  configPath: string;
  defaultPromptPath?: string;
  access?: PromptFileAccess;
};

export type ToolPromptRendererOptions = {
  configPath: string;
  instancePromptFiles?: ToolPromptFileMap;
  models?: ReadonlyArray<PromptModel>;
  /** The boot-resolved engine list every tool description renders with. */
  webSearch?: PromptWebSearchInput;
  access?: PromptFileAccess;
};

const toContextKey = (contextPath: string) => contextPath.split('.').join('\0');

/** Context leaf paths a prompt file may emit. Later capabilities extend this list. */
export const PROMPT_CONTEXT_PATHS: ReadonlyArray<string> = [
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
  // Temporal anchor — unconditional, server-computed. The first namespace that
  // is always present; `context` stays out of PROMPT_GATE_KEYS deliberately.
  'context.systemTime',
  'context.systemTimezone',
  // The skill catalog's omission count is a raw integer (system-provided-skills D4).
  'skills.omitted',
];

/**
 * Keyed on parsed segments, not the display string: `{{[model.id]}}` reports an
 * allowlisted `original` of `model.id` while parsing to a *single* literal
 * segment, so it would look up a property that does not exist and silently
 * render empty. `\0` joins because a `.` join would let the two collide.
 */
const PROMPT_CONTEXT_KEYS: ReadonlySet<string> = new Set(
  PROMPT_CONTEXT_PATHS.map(toContextKey),
);

/**
 * The skill catalog entry vocabulary (system-provided-skills D4).
 */
const SKILL_CATALOG_ITEM_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'description',
]);

/**
 * The configured web-search engine vocabulary (extend-web-search D5). Each item
 * is a short set of fact phrases the web-search module builds from the resolved
 * configuration, so a template owns the wording around them; `objective` and
 * `description` are empty when the engine has none, which the projection turns
 * into an omission so `{{#if}}` can drop the clause.
 */
export type PromptWebSearchEngineItem = {
  readonly id: string;
  readonly type: WebSearchEngineConfig['type'];
  /** What the engine returns: results, a cited answer, or results and answers. */
  readonly kind: 'results' | 'answer' | 'results with answers';
  readonly position: string;
  readonly recency: string;
  readonly queryLimit: string;
  /** Absent when the engine ignores `objective`. */
  readonly objective?: string;
  /** Absent when the operator sets none; its entry period is already gone. */
  readonly description?: string;
};

/** The resolved `webSearch` projection; absent when no engine is configured. */
export type PromptWebSearchInput = {
  readonly engines: ReadonlyArray<PromptWebSearchEngineItem>;
};

/** The item vocabulary a `webSearch.engines` iteration may reference. */
const WEB_SEARCH_ENGINE_ITEM_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'type',
  'kind',
  'position',
  'recency',
  'queryLimit',
  'objective',
  'description',
]);

/**
 * Collections are declared with their complete item vocabulary. The same
 * segment-key discipline as scalar paths prevents bracketed paths from
 * spoofing a declared collection, while keeping later collection additions a
 * data change rather than a validator change.
 */
const PROMPT_COLLECTION_ITEM_FIELDS: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map([
  [toContextKey('skills.entries'), SKILL_CATALOG_ITEM_FIELDS],
  [toContextKey('webSearch.engines'), WEB_SEARCH_ENGINE_ITEM_FIELDS],
]);

/** Paths valid only as a conditional's subject, never as output. */
const PROMPT_GATE_KEYS: ReadonlySet<string> = new Set([
  ...['user', 'user.personalization', 'skills', 'webSearch'].map(toContextKey),
  ...PROMPT_COLLECTION_ITEM_FIELDS.keys(),
]);

/**
 * Tool predicate keys are validated as provider-safe exact ids without looking
 * at the runtime registry. Object prototype names are not tool identities:
 * accepting one would make a missing predicate depend on inherited properties.
 */
const PROMPT_TOOL_RESERVED_KEYS: ReadonlySet<string> = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  'prototype',
]);

function isPromptToolId(id: string): boolean {
  if (PROMPT_TOOL_RESERVED_KEYS.has(id) || !isToolId(id)) {
    return false;
  }

  return !id.startsWith('mcp__') || parseMcpToolId(id).success;
}

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

/** `else` needs no entry: it is the `inverse` of its block. */
const ALLOWED_BLOCK_HELPERS: ReadonlySet<string> = new Set([
  'if',
  'unless',
  'each',
]);

export type RenderSystemPromptInput = {
  template: string;
  model: Pick<PromptModel, 'id' | 'name'>;
  anchor: TemporalAnchor;
  user?: PromptUserInput;
  skills?: PromptSkillsInput;
  webSearch?: PromptWebSearchInput;
  admittedToolIds?: ReadonlyArray<string>;
};

/**
 * A tool description render never takes the collection from its caller: the
 * renderer resolved it once at boot from the configuration, exactly as it
 * resolved the model paths, so an attempt cannot render a list the worker did
 * not resolve.
 */
export type ToolPromptRenderInput = Omit<
  RenderSystemPromptInput,
  'template' | 'webSearch'
> & {
  toolId: ToolPromptId;
};

/** The renderer's complete, typed input/output contract. */
export type ToolPromptRenderer = {
  render(input: ToolPromptRenderInput): RenderedPrompt;
};

export type RenderedPrompt = {
  readonly text: string;
};

/** Renders a complete prompt from the explicit renderable projection. */
export function renderSystemPromptTemplate(
  input: RenderSystemPromptInput,
): RenderedPrompt {
  return renderPrompt(input.template, input);
}

export function resolveDefaultChatSystemPromptPath(
  moduleDirectory: string,
): string {
  return path.resolve(moduleDirectory, '../prompts/chat-default.md');
}

export const DEFAULT_CHAT_SYSTEM_PROMPT_PATH =
  resolveDefaultChatSystemPromptPath(__dirname);

export type ModelPromptResolution = {
  systemPromptTemplate: string;
  systemPromptSource: SystemPromptSource;
  /**
   * Whether this template references the `skills` namespace at all
   * (system-provided-skills D4). Recorded at boot from the validated AST, so
   * the notices layer consults a decision rather than re-parsing a rendered
   * prompt, and so a model that opts out is known before any render.
   */
  referencesSkills: boolean;
};

export type ModelPromptLoader = {
  resolve(model: PromptModel): ModelPromptResolution;
  validateProjectDefault(): void;
};

// Representative anchor for boot probes — every combination supplies it, and
// no probe exercises its absence, because no run can produce it.
const PROBE_ANCHOR: TemporalAnchor = {
  systemTime: '2000-01-01 00:00+00:00',
  systemTimezone: 'UTC',
};

const PROBE_USER: PromptUserInput = { preferredName: 'probe' };

// The skill catalog gates independently of `user`, so it joins the cross
// product for the same reason: its section can be the only template content.
const PROBE_SKILLS: PromptSkillsInput = {
  entries: [{ name: 'probe', description: 'probe' }],
  omitted: 0,
};

// The engine list gates independently too: a template whose only content is
// the list renders empty for a deployment without a `webSearch` section.
const PROBE_WEB_SEARCH: PromptWebSearchInput = {
  engines: [
    {
      id: 'probe',
      type: 'brave',
      kind: 'results',
      position: 'probe',
      recency: 'probe',
      queryLimit: 'probe',
      description: 'probe',
    },
  ],
};

/** Independent combinations of optional render context for boot probes. */
type PromptProbeGates = {
  readonly user?: PromptUserInput;
  readonly skills?: PromptSkillsInput;
  readonly webSearch?: PromptWebSearchInput;
};

const SYSTEM_PROMPT_EMPTY_RENDER_PROBES: ReadonlyArray<PromptProbeGates> = [
  {},
  { user: PROBE_USER },
  { skills: PROBE_SKILLS },
  { webSearch: PROBE_WEB_SEARCH },
  { user: PROBE_USER, skills: PROBE_SKILLS },
  { user: PROBE_USER, webSearch: PROBE_WEB_SEARCH },
  { skills: PROBE_SKILLS, webSearch: PROBE_WEB_SEARCH },
  { user: PROBE_USER, skills: PROBE_SKILLS, webSearch: PROBE_WEB_SEARCH },
];

/**
 * Whether some gate state renders the template as whitespace alone under BOTH
 * probed tool memberships — no tools admitted and every tool the template
 * names. Such a state is one no attempt can serve, and it fails boot. Shared
 * by the system prompt and the tool descriptions: both render through this
 * projection, so the two must not disagree about which templates cannot be
 * served.
 */
function rendersEmptyForSomeGateState(
  template: string,
  model: PromptModel,
  toolPredicateIds: ReadonlyArray<string>,
): boolean {
  const toolProbeMemberships: ReadonlyArray<ReadonlyArray<string>> =
    toolPredicateIds.length === 0 ? [[]] : [[], toolPredicateIds];

  // user/skills probe empty, so an absent tool cannot be the reason.
  return SYSTEM_PROMPT_EMPTY_RENDER_PROBES.some(({ user, skills, webSearch }) =>
    toolProbeMemberships.every(
      (probeToolIds) =>
        renderSystemPromptTemplate({
          template,
          model,
          anchor: PROBE_ANCHOR,
          user,
          skills,
          webSearch,
          admittedToolIds: probeToolIds,
        }).text.trim().length === 0,
    ),
  );
}

function assertBootPromptNonEmpty(
  template: string,
  model: PromptModel,
  field: string,
  toolPredicateIds: ReadonlyArray<string>,
): void {
  if (rendersEmptyForSomeGateState(template, model, toolPredicateIds)) {
    throw new InstanceConfigError(`${field}: rendered prompt is empty`);
  }
}

/**
 * The same gate for one loaded description file, run against every model that
 * can serve it — a packaged or instance-scoped file serves each configured
 * model, and a probe renders WITH its model, so a file whose only content is a
 * model value can be empty for one configured model and populated for another.
 */
function assertBootToolDescriptionNonEmpty(
  loaded: LoadedPromptFile,
  field: string,
  models: ReadonlyArray<PromptModel>,
): void {
  for (const model of models) {
    if (
      rendersEmptyForSomeGateState(
        loaded.template,
        model,
        loaded.toolPredicateIds,
      )
    ) {
      throw new InstanceConfigError(`${field}: rendered description is empty`);
    }
  }
}

/** One validated prompt file: its normalized text and the boot-time facts
 *  about it that later layers consult rather than re-derive. */
type LoadedPromptFile = {
  readonly template: string;
  readonly referencesSkills: boolean;
  readonly toolPredicateIds: ReadonlyArray<string>;
};

/** Read, validate, and cache one prompt file by its resolved path — several
 *  models may share one `systemPromptFile`, so `loadedFiles` (owned by the
 *  loader instance, threaded in) makes a repeat read-and-validate no-op.
 *  Compilation is NOT done here — the catalog carries the template as a
 *  string, and `renderSystemPromptTemplate` compiles once per distinct
 *  source on the render path. */
function loadPromptFile(
  filePath: string,
  field: string,
  access: PromptFileAccess,
  loadedFiles: Map<string, LoadedPromptFile>,
): LoadedPromptFile {
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

  let normalized: string;

  try {
    normalized = readPromptSource(resolvedPath, access);
  } catch (error) {
    throw promptReadError(field, error);
  }

  if (normalized.length === 0) {
    throw new InstanceConfigError(`${field}: prompt file is empty`);
  }

  const loaded: LoadedPromptFile = {
    template: normalized,
    ...assertSupportedTemplate(normalized, field),
  };

  loadedFiles.set(resolvedPath, loaded);

  return loaded;
}

/** The state one `createModelPromptLoader` instance closes over — bundled so
 *  `resolveModelPrompt` can take it as a single parameter. */
type PromptLoaderState = {
  readonly access: PromptFileAccess;
  readonly defaultPromptPath: string;
  readonly configDirectory: string;
  readonly loadedFiles: Map<string, LoadedPromptFile>;
};

function resolveModelPrompt(
  model: PromptModel,
  state: PromptLoaderState,
): ModelPromptResolution {
  const { access, defaultPromptPath, configDirectory, loadedFiles } = state;
  const field = `models[${model.id}].systemPromptFile`;
  const override = model.systemPromptFile;

  // `path.resolve` returns an absolute second argument unchanged.
  const promptPath =
    override === undefined
      ? defaultPromptPath
      : path.resolve(configDirectory, override);

  const loadedPrompt = loadPromptFile(promptPath, field, access, loadedFiles);
  const { template: systemPromptTemplate, toolPredicateIds } = loadedPrompt;
  assertBootPromptNonEmpty(
    systemPromptTemplate,
    model,
    field,
    toolPredicateIds,
  );

  return {
    // The catalog carries the TEMPLATE, not a rendered string and not a
    // closure over one: per-user and per-chat values resolve per run, and
    // rendering is `SystemPromptsService`'s job. Keeping the entry plain
    // data is what lets it stay serializable and lets a fixture be an
    // object literal.
    systemPromptTemplate,
    systemPromptSource:
      override === undefined ? 'project_default' : 'model_override',
    referencesSkills: loadedPrompt.referencesSkills,
  };
}

export function createModelPromptLoader(
  options: ModelPromptLoaderOptions,
): ModelPromptLoader {
  const state: PromptLoaderState = {
    access: options.access ?? DEFAULT_PROMPT_FILE_ACCESS,
    defaultPromptPath: path.resolve(
      options.defaultPromptPath ?? DEFAULT_CHAT_SYSTEM_PROMPT_PATH,
    ),
    configDirectory: path.dirname(options.configPath),
    loadedFiles: new Map<string, LoadedPromptFile>(),
  };

  return {
    resolve: (model) => resolveModelPrompt(model, state),
    validateProjectDefault: () => {
      loadPromptFile(
        state.defaultPromptPath,
        'project default system prompt asset',
        state.access,
        state.loadedFiles,
      );
    },
  };
}

const RETIRED_TOOL_PROMPT_IDS = {
  conversation_read: true,
} as const;

function assertToolPromptOverrideKeys(
  files: ToolPromptFileMap | undefined,
  field: string,
): void {
  for (const id of Object.keys(files ?? {})) {
    if (Object.hasOwn(RETIRED_TOOL_PROMPT_IDS, id)) {
      throw new InstanceConfigError(
        `${field}: "${id}" is retired; use read with a chat:// locator`,
      );
    }

    if (!isToolPromptId(id)) {
      throw new InstanceConfigError(
        `${field}: unsupported tool prompt override "${id}"`,
      );
    }
  }
}

type ToolPromptFileLoadInput = {
  files: ToolPromptFileMap | undefined;
  field: string;
  configDirectory: string;
  access: PromptFileAccess;
  loadedFiles: Map<string, LoadedPromptFile>;
  /** Every model these files can serve; the empty-render probe runs per model. */
  models: ReadonlyArray<PromptModel>;
};

function loadToolPromptFiles(
  input: ToolPromptFileLoadInput,
): Map<ToolPromptId, LoadedPromptFile> {
  const loaded = new Map<ToolPromptId, LoadedPromptFile>();

  for (const [id, configuredPath] of Object.entries(input.files ?? {})) {
    if (configuredPath === null || configuredPath === undefined) {
      continue;
    }

    if (!isToolPromptId(id)) {
      throw new InstanceConfigError(
        `${input.field}: unsupported tool prompt override "${id}"`,
      );
    }

    const field = `${input.field}.${id}`;

    const loadedFile = loadPromptFile(
      path.resolve(input.configDirectory, configuredPath),
      field,
      input.access,
      input.loadedFiles,
    );

    assertBootToolDescriptionNonEmpty(loadedFile, field, input.models);
    loaded.set(id, loadedFile);
  }

  return loaded;
}

function loadPackagedToolPromptFiles(
  access: PromptFileAccess,
  loadedFiles: Map<string, LoadedPromptFile>,
  models: ReadonlyArray<PromptModel>,
): Map<ToolPromptId, LoadedPromptFile> {
  const packaged = new Map<ToolPromptId, LoadedPromptFile>();

  for (const id of TOOL_PROMPT_IDS) {
    const field = `packaged tool description [${id}]`;

    const loadedFile = loadPromptFile(
      resolvePackagedToolDescriptionPath(id),
      field,
      access,
      loadedFiles,
    );

    assertBootToolDescriptionNonEmpty(loadedFile, field, models);
    packaged.set(id, loadedFile);
  }

  return packaged;
}

type ToolPromptSources = {
  packaged: Map<ToolPromptId, LoadedPromptFile>;
  instance: Map<ToolPromptId, LoadedPromptFile>;
  modelOverrides: Map<string, Map<ToolPromptId, LoadedPromptFile>>;
};

function loadToolPromptSources(
  options: ToolPromptRendererOptions,
  access: PromptFileAccess,
  configDirectory: string,
  loadedFiles: Map<string, LoadedPromptFile>,
): ToolPromptSources {
  const models = options.models ?? [];
  const packaged = loadPackagedToolPromptFiles(access, loadedFiles, models);
  assertToolPromptOverrideKeys(
    options.instancePromptFiles,
    'tools.promptFiles',
  );

  const instance = loadToolPromptFiles({
    files: options.instancePromptFiles,
    field: 'tools.promptFiles',
    configDirectory,
    access,
    loadedFiles,
    models,
  });

  const modelOverrides = new Map<string, Map<ToolPromptId, LoadedPromptFile>>();

  for (const model of models) {
    const field = `models[${model.id}].toolPromptFiles`;
    assertToolPromptOverrideKeys(model.toolPromptFiles, field);
    modelOverrides.set(
      model.id,
      loadToolPromptFiles({
        files: model.toolPromptFiles,
        field,
        configDirectory,
        access,
        loadedFiles,
        models: [model],
      }),
    );
  }

  return { packaged, instance, modelOverrides };
}

function selectToolPromptSources(
  options: ToolPromptRendererOptions,
  sources: ToolPromptSources,
): Map<string, ReadonlyMap<ToolPromptId, LoadedPromptFile>> {
  const selectedByModel = new Map<
    string,
    ReadonlyMap<ToolPromptId, LoadedPromptFile>
  >();

  for (const model of options.models ?? []) {
    const selected = new Map<ToolPromptId, LoadedPromptFile>();
    const modelFiles = sources.modelOverrides.get(model.id);

    for (const id of TOOL_PROMPT_IDS) {
      const source =
        modelFiles?.get(id) ??
        sources.instance.get(id) ??
        sources.packaged.get(id);

      if (source !== undefined) {
        selected.set(id, source);
      }
    }

    selectedByModel.set(model.id, selected);
  }

  return selectedByModel;
}

/**
 * Worker-owned tool description templates. All package and configured files
 * are read and validated when this renderer is created, while rendering stays
 * per attempt and uses the same projection as the system prompt.
 */
export function createToolPromptRenderer(
  options: ToolPromptRendererOptions,
): ToolPromptRenderer {
  const access = options.access ?? DEFAULT_PROMPT_FILE_ACCESS;
  const configDirectory = path.dirname(options.configPath);
  const loadedFiles = new Map<string, LoadedPromptFile>();

  const sources = loadToolPromptSources(
    options,
    access,
    configDirectory,
    loadedFiles,
  );

  const selectedByModel = selectToolPromptSources(options, sources);

  return {
    render: (input) => {
      const source =
        selectedByModel.get(input.model.id)?.get(input.toolId) ??
        sources.instance.get(input.toolId) ??
        sources.packaged.get(input.toolId);

      if (source === undefined) {
        throw new InstanceConfigError(
          `tool description "${input.toolId}" has no packaged source`,
        );
      }

      return renderSystemPromptTemplate({
        template: source.template,
        model: input.model,
        anchor: input.anchor,
        user: input.user,
        webSearch: options.webSearch,
        admittedToolIds: input.admittedToolIds,
      });
    },
  };
}

function unsupported(field: string, construct: string): InstanceConfigError {
  return new InstanceConfigError(
    `${field}: unsupported prompt construct "${construct}"`,
  );
}

// handlebars types every AST node's `type` as plain `string` (the shipped
// `hbs.AST.Expression`/`Statement` supertypes are not discriminated unions),
// so `node.type === 'X'` alone never narrows `node` itself — these explicit
// predicates are the one place that trusts the exact literal each subtype
// declares for its own `type` field.
function isPathExpression(
  node: hbs.AST.Expression,
): node is hbs.AST.PathExpression {
  return node.type === 'PathExpression';
}

function isMustacheStatement(
  node: hbs.AST.Statement,
): node is hbs.AST.MustacheStatement {
  return node.type === 'MustacheStatement';
}

function isBlockStatement(
  node: hbs.AST.Statement,
): node is hbs.AST.BlockStatement {
  return node.type === 'BlockStatement';
}

function isContentStatement(
  node: hbs.AST.Statement,
): node is hbs.AST.ContentStatement {
  return node.type === 'ContentStatement';
}

function promptToolPredicateId(node: hbs.AST.Expression): string | undefined {
  if (
    !isPathExpression(node) ||
    node.depth > 0 ||
    node.data ||
    node.parts.length !== 2 ||
    node.parts[0] !== 'tools'
  ) {
    return undefined;
  }

  const id = node.parts[1];

  return isString(id) && isPromptToolId(id) ? id : undefined;
}

/**
 * Rejects any path expression that is not reachable from `position`.
 *
 * `@`-data references (`@index`, `@key`, `@first`, `@last`) are rejected here
 * rather than by segment name: handlebars parses them as ordinary path
 * expressions carrying a `data` flag, so a segment-only check would let every
 * one of them through.
 */
function assertPath(
  node: hbs.AST.Expression,
  field: string,
  position: 'value' | 'conditional' | 'item' = 'value',
  itemFields?: ReadonlySet<string>,
): void {
  if (!isPathExpression(node)) {
    throw unsupported(field, node.type);
  }

  const expression = node;

  if (expression.parts[0] === 'chats') {
    throw new InstanceConfigError(
      `${field}: retired chats namespace; remove these references because the digest uses context items`,
    );
  }

  const key = expression.parts.join('\0');

  const toolPredicateId =
    position === 'conditional' ? promptToolPredicateId(expression) : undefined;

  const permitted =
    !expression.data &&
    // Inside an iteration ONLY that collection's declared item fields resolve,
    // as single segments — the outer allowlists are deliberately unreachable.
    (position === 'item'
      ? expression.parts.length === 1 &&
        itemFields?.has(expression.parts[0]) === true
      : PROMPT_CONTEXT_KEYS.has(key) ||
        (position === 'conditional' &&
          (PROMPT_GATE_KEYS.has(key) || toolPredicateId !== undefined)));

  // `depth > 0` is `../`, which climbs out of the projected context.
  if (expression.depth > 0 || !permitted) {
    throw unsupported(field, `{{${String(expression.original)}}}`);
  }
}

/**
 * Validates an `each` subject and hands back the item vocabulary its body may
 * reference.
 *
 * Separate from `assertPath` because this position is the one that also
 * RESOLVES something. Folding it in made the permission check return a set that
 * three of its four positions never populated, which in turn forced an
 * unreachable undefined-guard at the call site.
 */
function assertCollectionPath(
  node: hbs.AST.Expression,
  field: string,
): ReadonlySet<string> {
  if (!isPathExpression(node)) {
    throw unsupported(field, node.type);
  }

  const expression = node;

  if (expression.parts[0] === 'chats') {
    throw new InstanceConfigError(
      `${field}: retired chats namespace; remove these references because the digest uses context items`,
    );
  }

  const itemFields = PROMPT_COLLECTION_ITEM_FIELDS.get(
    expression.parts.join('\0'),
  );

  // Only a DECLARED collection is iterable — never a scalar, a gate-only path,
  // an unknown path, or anything reached through `../`.
  if (expression.depth > 0 || expression.data || itemFields === undefined) {
    throw unsupported(field, `{{${String(expression.original)}}}`);
  }

  return itemFields;
}

function assertMustacheStatement(
  mustache: hbs.AST.MustacheStatement,
  field: string,
  itemFields: ReadonlySet<string> | undefined,
): void {
  if (!mustache.escaped) {
    throw unsupported(field, 'unescaped output');
  }

  // A parameterized value expression is a helper invocation; this also
  // covers subexpressions, which parse as a parameter.
  if (mustache.params.length > 0 || mustache.hash !== undefined) {
    throw unsupported(field, 'helper invocation');
  }

  assertPath(
    mustache.path,
    field,
    itemFields === undefined ? 'value' : 'item',
    itemFields,
  );
}

/** The `{{#each}}` half of `assertBlockStatement` — split out purely to keep
 *  its "already inside an iteration" guard from nesting a 4th block deep. */
function assertEachBlock(
  block: hbs.AST.BlockStatement,
  field: string,
  itemFields: ReadonlySet<string> | undefined,
): void {
  // An already-set item scope means we are inside an iteration, so this
  // is a nested one.
  if (itemFields !== undefined) {
    throw unsupported(field, 'nested each');
  }

  const collectionItemFields = assertCollectionPath(block.params[0], field);
  // The inverse arm renders only for an ABSENT collection, so it has no
  // item to read — but it keeps the item scope rather than falling back
  // to the outer one, which would make an iteration's `else` a hole
  // through which outer paths re-enter the body.
  assertStatements(block.program?.body ?? [], field, collectionItemFields);
  assertStatements(block.inverse?.body ?? [], field, collectionItemFields);
}

function assertBlockStatement(
  block: hbs.AST.BlockStatement,
  field: string,
  itemFields: ReadonlySet<string> | undefined,
): void {
  const helper = block.path.original;

  if (!isString(helper) || !ALLOWED_BLOCK_HELPERS.has(helper)) {
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

  if (helper === 'each') {
    assertEachBlock(block, field, itemFields);

    return;
  }

  assertPath(
    block.params[0],
    field,
    itemFields === undefined ? 'conditional' : 'item',
    itemFields,
  );
  assertStatements(block.program?.body ?? [], field, itemFields);
  assertStatements(block.inverse?.body ?? [], field, itemFields);
}

function assertStatements(
  body: ReadonlyArray<hbs.AST.Statement>,
  field: string,
  itemFields?: ReadonlySet<string>,
): void {
  for (const node of body) {
    if (!ALLOWED_NODE_TYPES.has(node.type)) {
      throw unsupported(field, node.type);
    }

    if (isMustacheStatement(node)) {
      assertMustacheStatement(node, field, itemFields);
      continue;
    }

    if (isBlockStatement(node)) {
      assertBlockStatement(node, field, itemFields);
    }
  }
}

function collectToolPredicateIds(
  body: ReadonlyArray<hbs.AST.Statement>,
  ids: Set<string>,
): void {
  for (const node of body) {
    if (!isBlockStatement(node)) {
      continue;
    }

    const helper = node.path.original;

    if (helper === 'if' || helper === 'unless') {
      const id = promptToolPredicateId(node.params[0]);

      if (id !== undefined) {
        ids.add(id);
      }
    }

    collectToolPredicateIds(node.program?.body ?? [], ids);
    collectToolPredicateIds(node.inverse?.body ?? [], ids);
  }
}

/**
 * Whether any literal text exists anywhere in the template, including inside
 * conditional bodies — a prompt may legitimately consist of nothing but an
 * `{{#if}}` block wrapping its only prose.
 */
function hasLiteralContent(body: ReadonlyArray<hbs.AST.Statement>): boolean {
  return body.some((node) => {
    if (isContentStatement(node)) {
      return node.value.trim().length > 0;
    }

    if (isBlockStatement(node)) {
      const block = node;

      return (
        hasLiteralContent(block.program?.body ?? []) ||
        hasLiteralContent(block.inverse?.body ?? [])
      );
    }

    return false;
  });
}

/**
 * Validate one template and report the boot-time facts about it that later
 * layers consult rather than re-derive: whether it references the `skills`
 * namespace, and which tool predicates it gates on. Reuses the single parse
 * validation already performs, so boot records both answers without a second
 * parse or a render.
 */
function assertSupportedTemplate(prompt: string, field: string) {
  let ast: hbs.AST.Program;

  try {
    ast = parsePromptTemplate(prompt);
  } catch {
    throw new InstanceConfigError(`${field}: prompt template failed to parse`);
  }

  assertStatements(ast.body, field);

  if (!hasLiteralContent(ast.body)) {
    throw new InstanceConfigError(`${field}: prompt file is empty`);
  }

  const toolPredicateIds = new Set<string>();
  collectToolPredicateIds(ast.body, toolPredicateIds);

  return {
    referencesSkills: referencesSkillsNamespace(ast.body),
    toolPredicateIds: [...toolPredicateIds],
  };
}

/**
 * Whether any path in the template is rooted at `skills`. Walks expressions
 * rather than node types, so it sees a reference in value, conditional,
 * iteration-subject, or parameter position alike.
 *
 * Runs after the template is validated, so each block carries exactly one
 * parameter - its subject - and always a program: `{{#if x}}{{else}}y{{/if}}`
 * gives the program an empty body rather than none. An inverse exists only
 * when an `else` is written.
 */
function referencesSkillsNamespace(
  body: ReadonlyArray<hbs.AST.Statement>,
): boolean {
  for (const node of body) {
    if (isMustacheStatement(node) && pathRootsAtSkills(node.path)) return true;

    if (!isBlockStatement(node)) continue;

    for (const subject of node.params) {
      if (pathRootsAtSkills(subject)) return true;
    }

    if (referencesSkillsNamespace(node.program.body)) return true;

    if (referencesSkillsNamespace(node.inverse?.body ?? [])) return true;
  }

  return false;
}

function pathRootsAtSkills(node: hbs.AST.Expression): boolean {
  return isPathExpression(node) && node.parts[0] === 'skills';
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

  type UserPromptContext = {
    personalization?: typeof authored;
    name?: typeof name;
    email?: typeof email;
  };

  const context: UserPromptContext = {};

  if (hasAuthored) context.personalization = authored;

  if (name !== undefined) context.name = name;

  if (email !== undefined) context.email = email;

  return Object.keys(context).length === 0 ? undefined : context;
}

/**
 * Projects the frozen skill-catalog baseline independently of other namespaces.
 * An absent or empty admission yields no `skills` object.
 */
function skillsContext(skills: PromptSkillsInput | undefined) {
  if (skills === undefined || skills.entries.length === 0) return undefined;

  return {
    entries: skills.entries.map((entry) => ({
      name: promptValue(entry.name),
      description: promptValue(entry.description, sanitizeAuthoredText),
    })),
    omitted: skills.omitted,
  };
}

/**
 * Projects the resolved engine list independently of every other namespace, so
 * `{{#if webSearch}}` gates the whole section and an absent or empty
 * configuration renders no list at all.
 *
 * Every value arrives already neutralized — the web-search module applies the
 * tag sanitizer and the list-fence neutralization — so each one is wrapped
 * verbatim: escaping it again would render `&lt;` as `&amp;lt;`. The two
 * optional facts take `promptValue`'s identity neutralizer, whose omission rule
 * is what drops a `{{#if}}` clause it has nothing to say about.
 */
function webSearchContext(webSearch: PromptWebSearchInput | undefined) {
  if (webSearch === undefined || webSearch.engines.length === 0) {
    return undefined;
  }

  return {
    engines: webSearch.engines.map((engine) => ({
      id: promptSafeString(engine.id),
      type: promptSafeString(engine.type),
      kind: promptSafeString(engine.kind),
      position: promptSafeString(engine.position),
      recency: promptSafeString(engine.recency),
      queryLimit: promptSafeString(engine.queryLimit),
      // The identity neutralizer: these values reach the projection already
      // neutralized, and `promptValue`'s omission rule is what makes an absent
      // fact drop its `{{#if}}` clause.
      objective: promptValue(engine.objective, (value) => value),
      description: promptValue(engine.description, (value) => value),
    })),
  };
}

function projectToolPredicates(
  admittedToolIds: ReadonlyArray<string> | undefined,
): Readonly<Record<string, boolean>> {
  const tools = Object.fromEntries(
    (admittedToolIds ?? []).map((id) => [id, true] as const),
  );

  Object.setPrototypeOf(tools, null);

  return tools;
}

type RenderPromptContext = {
  model: {
    id: PromptSafeValue | undefined;
    name: PromptSafeValue | undefined;
  };
  context: {
    systemTime: PromptSafeValue;
    systemTimezone: PromptSafeValue;
  };
  user?: ReturnType<typeof userContext>;
  skills?: ReturnType<typeof skillsContext>;
  webSearch?: ReturnType<typeof webSearchContext>;
  tools: Readonly<Record<string, boolean>>;
};

/**
 * Builds one render's context. Split from `renderPrompt` because the omission
 * rule is the whole of this module's correctness argument and it reads as one
 * sequence: project each namespace, then add it only when it has content.
 */
function promptContext(
  fields: Omit<RenderSystemPromptInput, 'template'>,
): RenderPromptContext {
  const { model, anchor, user, skills, webSearch, admittedToolIds } = fields;

  const projectedUser = userContext(user);
  const projectedSkills = skillsContext(skills);
  const projectedWebSearch = webSearchContext(webSearch);

  const renderContext: RenderPromptContext = {
    model: {
      id: promptValue(model.id),
      name: promptValue(model.name),
    },
    context: {
      systemTime: promptSafeString(escapeForPrompt(anchor.systemTime)),
      systemTimezone: promptSafeString(escapeForPrompt(anchor.systemTimezone)),
    },
    tools: projectToolPredicates(admittedToolIds),
  };

  if (projectedUser !== undefined) renderContext.user = projectedUser;

  if (projectedSkills !== undefined) renderContext.skills = projectedSkills;

  if (projectedWebSearch !== undefined)
    renderContext.webSearch = projectedWebSearch;

  return renderContext;
}

function renderPrompt(
  source: string,
  fields: Omit<RenderSystemPromptInput, 'template'>,
): RenderedPrompt {
  return {
    text: compilePromptTemplate(source)(promptContext(fields)),
  };
}

function promptReadError(field: string, error: unknown): InstanceConfigError {
  const code =
    error instanceof Error && 'code' in error ? error.code : undefined;

  if (code === 'ENOENT') {
    return new InstanceConfigError(`${field}: prompt file is missing`);
  }

  if (code === 'EACCES' || code === 'EPERM') {
    return new InstanceConfigError(`${field}: prompt file is unreadable`);
  }

  return new InstanceConfigError(`${field}: failed to read prompt file`);
}
