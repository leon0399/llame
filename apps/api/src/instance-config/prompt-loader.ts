import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import Handlebars from 'handlebars';

import { sanitizeAuthoredText } from './authored-text';
import { InstanceConfigError } from '@workspace/config-interpolation';
import { isString } from '../unknown-record';
import type {
  PromptChatDigestEntry,
  PromptChatsInput,
  PromptUserInput,
  SystemPromptSource,
} from '../models/model-catalog';
import type { TemporalAnchor } from '../prompts/temporal-anchor';
export type {
  PromptChatsInput,
  PromptUserInput,
} from '../models/model-catalog';
export type { TemporalAnchor } from '../prompts/temporal-anchor';

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
  // Digest metadata is server-computed scalar content. Collections stay out
  // of this value allowlist so they cannot stringify into a prompt.
  'chats.pinnedShown',
  'chats.pinnedTotal',
  'chats.recentShown',
  'chats.recentTotal',
  'chats.compiledOn',
  // Temporal anchor — unconditional, server-computed. The first namespace that
  // is always present; `context` stays out of PROMPT_GATE_KEYS deliberately.
  'context.systemTime',
  'context.systemTimezone',
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
 * One vocabulary shared by both digest collections: they differ in which chats
 * they list, not in what an entry carries. Declared once so the two cannot
 * silently drift apart.
 */
const CHAT_DIGEST_ITEM_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'date',
  'messageCount',
  'excerpt',
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
  [toContextKey('chats.pinned'), CHAT_DIGEST_ITEM_FIELDS],
  [toContextKey('chats.recent'), CHAT_DIGEST_ITEM_FIELDS],
]);

/**
 * Paths valid ONLY as a conditional's subject — `{{#if user}}` or
 * `{{#if chats.recent}}` — and never as output. They name projection objects,
 * which exist so an operator can gate a whole section (framing prose included)
 * without emitting a stringified object.
 *
 * Kept out of `PROMPT_CONTEXT_PATHS` deliberately: emitting one would render a
 * stringified object, which is never what an author meant. Splitting by
 * POSITION rather than adding them to the value allowlist means `{{user}}`
 * still fails boot with the same message as any other unsupported construct.
 */
const PROMPT_GATE_KEYS: ReadonlySet<string> = new Set([
  ...['user', 'user.personalization', 'chats'].map(toContextKey),
  ...PROMPT_COLLECTION_ITEM_FIELDS.keys(),
]);

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

/** Narrower than handlebars' default, which also mangles `'`, `"`, `=`, and backticks. */
const PROMPT_ESCAPES = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
]);

function escapeForPrompt(value: string): string {
  return value.replaceAll(/[&<>]/gu, (character) => {
    const escaped = PROMPT_ESCAPES.get(character);
    if (escaped === undefined) {
      // Unreachable: the regex above only ever matches a PROMPT_ESCAPES key.
      throw new Error(`Unexpected character in prompt escape: "${character}"`);
    }
    return escaped;
  });
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
 * transform differs. Model, account-identity, and digest-metadata values take
 * the strict `&<>` escape, being short server-computed strings with no
 * legitimate markup. Owner-authored fields and digest item fields take
 * `sanitizeAuthoredText` instead — whose rules are what keep the template's
 * fences unforgeable without mangling legitimate structure in authored text.
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

export type RenderSystemPromptInput = {
  template: string;
  model: Pick<PromptModel, 'id' | 'name'>;
  anchor: TemporalAnchor;
  user?: PromptUserInput;
  chats?: PromptChatsInput;
};

/**
 * Renders one model's complete system prompt.
 *
 * Lives here rather than in the service that exposes it because the render
 * context is built with `templates.SafeString`, and a value must come from the
 * SAME created Handlebars environment that renders it or the engine escapes it
 * a second time. `SystemPromptsService` is the injectable wrapper over this.
 */
export function renderSystemPromptTemplate(
  input: RenderSystemPromptInput,
): string {
  return renderPrompt(compileTemplate(input.template), input);
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
};

export type ModelPromptLoader = {
  resolve(model: PromptModel): ModelPromptResolution;
  validateProjectDefault(): void;
};

// Boot-time probe fixtures for `resolve()`'s "did the config author's gates
// leave the template empty for someone" check — not the real render: per-user
// and per-chat values resolve per run, so all combinations of their
// independent gates must be exercised. The cross product is not
// belt-and-braces.
//
// It is tempting to argue that one probe suffices because per-user context
// "only ever adds content" — but `unless` is an allowed helper and
// `user`/`chats` are legal gate subjects, so `unless` INVERTS them. A template
// nested under `{{#if user}}{{#unless chats}}` renders non-empty with neither
// gate and with both gates, yet empty for owners who have a digest but no
// personalization. Varying the gates in lockstep would pass it at boot and
// fail for exactly that population in production.
//
// So a template empty for any gate combination fails startup rather than
// shipping a prompt that disappears for one owner population. Module-level
// (not rebuilt per `resolve()` call): none of these fixtures depend on the
// model being resolved.
const PROBE_USER: PromptUserInput = { preferredName: 'probe' };
// The probe only needs both collections non-empty; entry CONTENT is
// irrelevant to whether a template renders empty, so one entry serves both
// lists.
const PROBE_CHAT_DIGEST_ENTRY: PromptChatDigestEntry = {
  title: 'probe',
  date: '2000-01-01',
  messageCount: 1,
  excerpt: 'probe',
};
const PROBE_CHATS: PromptChatsInput = {
  pinned: [PROBE_CHAT_DIGEST_ENTRY],
  recent: [PROBE_CHAT_DIGEST_ENTRY],
  pinnedShown: 1,
  pinnedTotal: 1,
  recentShown: 1,
  recentTotal: 1,
  compiledOn: '2000-01-01',
};
// The two collections gate independently of each other, not just of `user`:
// an owner with only pinned chats and an owner with only recent ones are both
// ordinary production inputs, and each omits one collection from the context
// entirely. A template gated
// `{{#if chats.pinned}}{{#if chats.recent}}…{{/if}}{{/if}}` renders for the
// both-populated probe and empty for either one-sided owner, so probing only
// the both-populated shape passes at boot and fails in production for
// exactly those people.
const PROBE_CHATS_PINNED_ONLY: PromptChatsInput = {
  ...PROBE_CHATS,
  recent: [],
  recentShown: 0,
};
const PROBE_CHATS_RECENT_ONLY: PromptChatsInput = {
  ...PROBE_CHATS,
  pinned: [],
  pinnedShown: 0,
};
// Representative anchor for boot probes — every combination supplies it, and
// no probe exercises its absence, because no run can produce it.
const PROBE_ANCHOR: TemporalAnchor = {
  systemTime: '2000-01-01 00:00+00:00',
  systemTimezone: 'UTC',
};
const SYSTEM_PROMPT_EMPTY_RENDER_PROBES: ReadonlyArray<
  readonly [PromptUserInput | undefined, PromptChatsInput | undefined]
> = [
  [undefined, undefined],
  [PROBE_USER, undefined],
  [undefined, PROBE_CHATS],
  [PROBE_USER, PROBE_CHATS],
  [undefined, PROBE_CHATS_PINNED_ONLY],
  [PROBE_USER, PROBE_CHATS_PINNED_ONLY],
  [undefined, PROBE_CHATS_RECENT_ONLY],
  [PROBE_USER, PROBE_CHATS_RECENT_ONLY],
];

/** Read, validate, and cache one prompt file by its resolved path — several
 *  models may share one `systemPromptFile`, so `loadedFiles` (owned by the
 *  loader instance, threaded in) makes a repeat read-and-validate a no-op.
 *  Compilation is NOT done here — the catalog carries the template as a
 *  string, and `renderSystemPromptTemplate` compiles once per distinct
 *  source on the render path. */
function loadPromptFile(
  filePath: string,
  field: string,
  access: PromptFileAccess,
  loadedFiles: Map<string, string>,
): string {
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

  const normalized = raw.replaceAll(/\r\n?/gu, '\n').replace(/\s+$/u, '');
  if (normalized.length === 0) {
    throw new InstanceConfigError(`${field}: prompt file is empty`);
  }
  assertSupportedTemplate(normalized, field);
  loadedFiles.set(resolvedPath, normalized);
  return normalized;
}

/** The state one `createModelPromptLoader` instance closes over — bundled so
 *  `resolveModelPrompt` can take it as a single parameter. */
type PromptLoaderState = {
  readonly access: PromptFileAccess;
  readonly defaultPromptPath: string;
  readonly configDirectory: string;
  readonly loadedFiles: Map<string, string>;
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
  const systemPromptTemplate = loadPromptFile(
    promptPath,
    field,
    access,
    loadedFiles,
  );

  if (
    SYSTEM_PROMPT_EMPTY_RENDER_PROBES.some(
      ([userProbe, chatsProbe]) =>
        renderSystemPromptTemplate({
          template: systemPromptTemplate,
          model,
          anchor: PROBE_ANCHOR,
          user: userProbe,
          chats: chatsProbe,
        }).trim().length === 0,
    )
  ) {
    throw new InstanceConfigError(`${field}: rendered prompt is empty`);
  }

  return {
    // The catalog carries the TEMPLATE, not a rendered string and not a
    // closure over one: per-user and per-chat values resolve per run, and
    // rendering is `SystemPromptsService`'s job. Keeping the entry plain
    // data is what lets it stay serializable and lets a fixture be an
    // object literal.
    systemPromptTemplate,
    systemPromptSource:
      override === undefined ? 'project_default' : 'model_override',
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
    loadedFiles: new Map<string, string>(),
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
  const key = expression.parts.join('\0');
  const permitted =
    !expression.data &&
    // Inside an iteration ONLY that collection's declared item fields resolve,
    // as single segments — the outer allowlists are deliberately unreachable.
    (position === 'item'
      ? expression.parts.length === 1 &&
        itemFields?.has(expression.parts[0]) === true
      : PROMPT_CONTEXT_KEYS.has(key) ||
        (position === 'conditional' && PROMPT_GATE_KEYS.has(key)));
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

function chatEntryContext(entry: PromptChatDigestEntry) {
  return {
    title: promptValue(entry.title, sanitizeAuthoredText),
    date: promptValue(entry.date, sanitizeAuthoredText),
    messageCount: promptValue(String(entry.messageCount), sanitizeAuthoredText),
    excerpt: promptValue(entry.excerpt ?? undefined, sanitizeAuthoredText),
  };
}

/**
 * Projects chat-digest values independently of `user`. Coupling the namespaces
 * would make `{{#if user}}` true for digest-only owners and render an
 * operator's personalization framing around no personalization content.
 */
function chatsContext(chats: PromptChatsInput | undefined) {
  if (chats === undefined) {
    return undefined;
  }

  // Normalized to "absent or non-empty" once, so the emptiness rule is stated
  // in a single place. An empty ARRAY would be truthy, making `{{#if
  // chats.recent}}` pass over nothing.
  const projectList = (
    entries: ReadonlyArray<PromptChatDigestEntry> | undefined,
  ) =>
    entries === undefined || entries.length === 0
      ? undefined
      : entries.map(chatEntryContext);

  const pinned = projectList(chats.pinned);
  const recent = projectList(chats.recent);
  if (pinned === undefined && recent === undefined) {
    return undefined;
  }

  type ChatsPromptContext = {
    pinned?: typeof pinned;
    recent?: typeof recent;
    pinnedShown: typeof chats.pinnedShown;
    pinnedTotal: typeof chats.pinnedTotal;
    recentShown: typeof chats.recentShown;
    recentTotal: typeof chats.recentTotal;
    compiledOn: ReturnType<typeof promptValue>;
  };
  const result: ChatsPromptContext = {
    // Numbers, not strings. `promptValue` wraps its result in a SafeString,
    // and a SafeString is an object — so a stringified `0` is TRUTHY, and an
    // operator writing `{{#if chats.pinnedShown}}Showing …{{/if}}` would get
    // that framing rendered around a zero count. These are server-computed
    // integers with nothing to escape, so they need no wrapper to be safe.
    pinnedShown: chats.pinnedShown,
    pinnedTotal: chats.pinnedTotal,
    recentShown: chats.recentShown,
    recentTotal: chats.recentTotal,
    compiledOn: promptValue(chats.compiledOn),
  };
  if (pinned !== undefined) result.pinned = pinned;
  if (recent !== undefined) result.recent = recent;
  return result;
}

function renderPrompt(
  template: HandlebarsTemplateDelegate,
  fields: Omit<RenderSystemPromptInput, 'template'>,
): string {
  const { model, anchor, user, chats } = fields;
  // An allowlisted path with no value renders empty rather than failing, so
  // that `{{#if model.name}}...{{model.name}}...{{/if}}` is expressible. Typos
  // still fail loudly: an unknown path is rejected in
  // `assertSupportedTemplate`.
  const projectedUser = userContext(user);
  const projectedChats = chatsContext(chats);
  type RenderPromptContext = {
    model: {
      id: ReturnType<typeof promptValue>;
      name: ReturnType<typeof promptValue>;
    };
    context: {
      systemTime: Handlebars.SafeString;
      systemTimezone: Handlebars.SafeString;
    };
    user?: typeof projectedUser;
    chats?: typeof projectedChats;
  };
  const renderContext: RenderPromptContext = {
    model: {
      id: promptValue(model.id),
      name: promptValue(model.name),
    },
    // Unconditional — the first namespace that always is. Bypasses the
    // omission rule: these are always computable and never absent.
    context: {
      systemTime: new templates.SafeString(escapeForPrompt(anchor.systemTime)),
      systemTimezone: new templates.SafeString(
        escapeForPrompt(anchor.systemTimezone),
      ),
    },
  };
  if (projectedUser !== undefined) renderContext.user = projectedUser;
  if (projectedChats !== undefined) renderContext.chats = projectedChats;

  return template(renderContext);
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
