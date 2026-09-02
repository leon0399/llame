import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  getNodeValue,
  parseTree as parseJsoncTree,
  printParseErrorCode,
  type ParseError,
  visit,
} from 'jsonc-parser';

import {
  BUILT_IN_DEFAULTS,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  type EmbeddingModelCatalogEntry,
  type LlameConfig,
  type KnowledgeConfig,
  type McpRemoteServerConfig,
  type McpServerConfig,
  type McpStdioServerConfig,
  type ProviderConfig,
  type RawInstanceConfig,
  type RawMcpServerEntry,
  type RawModelEntry,
} from './llame-config';
import { InstanceConfigError } from '@workspace/config-interpolation';
import { getConfigValidator } from './schema';
import {
  InterpolationError,
  interpolateString,
  interpolateStringWithSubstitutions,
} from '@workspace/config-interpolation';
import { createModelPromptLoader } from './prompt-loader';
import { getRegisteredToolIds } from '../tools/registry';
import { createMcpToolId, parseMcpToolId } from '../mcp/tool-id';
import type {
  EffortLevel,
  ModelReasoning,
  SystemModelCatalogEntry,
} from '../models/model-catalog';
import {
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '../unknown-record';

const DEFAULT_CONFIG_FILENAME = 'llame.config.json';

/** Default `llame.config.json` in the API runtime cwd; `LLAME_CONFIG_PATH` overrides (D1). */
export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.LLAME_CONFIG_PATH?.trim();
  return path.resolve(
    process.cwd(),
    override && override.length > 0 ? override : DEFAULT_CONFIG_FILENAME,
  );
}

/** `defaults.modelId`/`defaults.titleGenerationModelId`, cross-checked
 *  against the already-resolved model catalog. */
function resolveDefaults(
  raw: RawInstanceConfig | undefined,
  env: NodeJS.ProcessEnv,
  modelIds: ReadonlySet<string>,
): LlameConfig['defaults'] {
  const modelId = resolveNullableString({
    configPath: 'defaults.modelId',
    ...readLeaf(raw, 'defaults', 'modelId'),
    env,
  });
  const titleGenerationModelId = resolveNullableString({
    configPath: 'defaults.titleGenerationModelId',
    ...readLeaf(raw, 'defaults', 'titleGenerationModelId'),
    env,
  });
  assertReferencesCatalog('defaults.modelId', modelId, modelIds, 'models[].id');
  assertReferencesCatalog(
    'defaults.titleGenerationModelId',
    titleGenerationModelId,
    modelIds,
    'models[].id',
  );
  return { modelId, titleGenerationModelId };
}

function resolveRunsConfig(
  raw: RawInstanceConfig | undefined,
  env: NodeJS.ProcessEnv,
): LlameConfig['runs'] {
  return {
    maxOutputTokens: resolveNumeric({
      configPath: 'runs.maxOutputTokens',
      ...readLeaf(raw, 'runs', 'maxOutputTokens'),
      builtInDefault: BUILT_IN_DEFAULTS.runs.maxOutputTokens,
      nullable: true,
      env,
    }),
    // nullable:false guarantees a number, never null — see resolveNumeric.
    heartbeatSeconds: requireResolvedNumber(
      resolveNumeric({
        configPath: 'runs.heartbeatSeconds',
        ...readLeaf(raw, 'runs', 'heartbeatSeconds'),
        builtInDefault: BUILT_IN_DEFAULTS.runs.heartbeatSeconds,
        nullable: false,
        // pg-boss's hard floor for a queue heartbeat window; an {env:...}
        // token resolving below this would otherwise crash boot with a raw
        // pg-boss assertion instead of a clear config error.
        min: 10,
        env,
      }),
      'runs.heartbeatSeconds',
    ),
    timeoutSeconds: requireResolvedNumber(
      resolveNumeric({
        configPath: 'runs.timeoutSeconds',
        ...readLeaf(raw, 'runs', 'timeoutSeconds'),
        builtInDefault: BUILT_IN_DEFAULTS.runs.timeoutSeconds,
        nullable: false,
        env,
      }),
      'runs.timeoutSeconds',
    ),
  };
}

function resolveHttpConfig(
  raw: RawInstanceConfig | undefined,
  env: NodeJS.ProcessEnv,
): LlameConfig['http'] {
  return {
    trustProxy: resolveNullableString({
      configPath: 'http.trustProxy',
      ...readLeaf(raw, 'http', 'trustProxy'),
      env,
    }),
  };
}

function resolveDbConfig(
  raw: RawInstanceConfig | undefined,
  env: NodeJS.ProcessEnv,
): LlameConfig['db'] {
  return {
    poolSize: requireResolvedNumber(
      resolveNumeric({
        configPath: 'db.poolSize',
        ...readLeaf(raw, 'db', 'poolSize'),
        builtInDefault: BUILT_IN_DEFAULTS.db.poolSize,
        nullable: false,
        env,
      }),
      'db.poolSize',
    ),
  };
}

function resolveToolsConfig(
  raw: RawInstanceConfig | undefined,
  env: NodeJS.ProcessEnv,
  mcpServers: Readonly<Record<string, McpServerConfig>>,
): LlameConfig['tools'] {
  return {
    allowed: resolveToolAllowlist({
      configPath: 'tools.allowed',
      ...readLeaf(raw, 'tools', 'allowed'),
      configuredMcpServerIds: new Set(Object.keys(mcpServers)),
    }),
    maxStepsPerRun: requireResolvedNumber(
      resolveNumeric({
        configPath: 'tools.maxStepsPerRun',
        ...readLeaf(raw, 'tools', 'maxStepsPerRun'),
        builtInDefault: BUILT_IN_DEFAULTS.tools.maxStepsPerRun,
        nullable: false,
        env,
      }),
      'tools.maxStepsPerRun',
    ),
    callTimeoutSeconds: requireResolvedNumber(
      resolveNumeric({
        configPath: 'tools.callTimeoutSeconds',
        ...readLeaf(raw, 'tools', 'callTimeoutSeconds'),
        builtInDefault: BUILT_IN_DEFAULTS.tools.callTimeoutSeconds,
        nullable: false,
        env,
      }),
      'tools.callTimeoutSeconds',
    ),
  };
}

/** Load, validate, interpolate, and apply file > built-in-default precedence (the environment reaches config only via {env:...} tokens in the file). Throws InstanceConfigError on any failure — the only correct response is to abort boot (D6). */
export function loadInstanceConfig(
  env: NodeJS.ProcessEnv = process.env,
): LlameConfig {
  const configPath = resolveConfigPath(env);
  const raw = readRawConfig(configPath);
  if (raw !== undefined) {
    assertValidRaw(raw, configPath);
  }

  const providers = resolveProviders(raw, env);
  const providerIds = new Set(providers.map((p) => p.id));
  const promptLoader = createModelPromptLoader({ configPath });
  const models = resolveModels(raw, env, providerIds, promptLoader);
  promptLoader.validateProjectDefault();
  const modelIds = new Set(models.map((m) => m.id));
  const embeddingModels = resolveEmbeddingModels(raw, env, providerIds);
  const embeddingModelIds = new Set(embeddingModels.map((m) => m.id));
  const search = resolveSearchConfig(raw, env, embeddingModelIds);
  const mcpServers = resolveMcpServers(raw, env);

  return {
    defaults: resolveDefaults(raw, env, modelIds),
    runs: resolveRunsConfig(raw, env),
    http: resolveHttpConfig(raw, env),
    db: resolveDbConfig(raw, env),
    tools: resolveToolsConfig(raw, env, mcpServers),
    mcpServers,
    knowledge: resolveKnowledge(raw, env),
    workers: resolveWorkerProfiles(raw),
    providers,
    models,
    embeddingModels,
    search,
  };
}

function resolveKnowledge(
  raw: RawInstanceConfig | undefined,
  env: NodeJS.ProcessEnv,
): KnowledgeConfig {
  const root = raw?.knowledge?.root;
  if (root === undefined) {
    return BUILT_IN_DEFAULTS.knowledge;
  }
  if (!isString(root)) {
    throw new InstanceConfigError('knowledge.root: must be a string');
  }

  const resolved = resolveInterpolatedString(
    root,
    'knowledge.root',
    env,
  ).trim();
  if (!path.isAbsolute(resolved)) {
    throw new InstanceConfigError(
      'knowledge.root: must resolve to an absolute path',
    );
  }
  return { root: resolved };
}

// ---- File read + parse -----------------------------------------------

function readRawConfig(configPath: string): UnknownRecord | undefined {
  let text: string;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw new InstanceConfigError(
      `Failed to read ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  assertNoDuplicateProperties(text, configPath);

  const errors: Array<ParseError> = [];
  const tree = parseJsoncTree(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  const result: unknown = tree === undefined ? undefined : getNodeValue(tree);
  if (errors.length > 0) {
    const first = errors[0];
    const { line, column } = offsetToLineColumn(text, first.offset);
    throw new InstanceConfigError(
      `Malformed JSONC in ${configPath} at line ${line}, column ${column}: ${printParseErrorCode(first.error)}`,
    );
  }
  if (!isRecord(result)) {
    throw new InstanceConfigError(
      `Invalid ${configPath}: top-level value must be a JSON object`,
    );
  }
  return result;
}

function assertNoDuplicateProperties(text: string, configPath: string): void {
  const propertiesByObject = new Map<string, Set<string>>();
  let duplicatePath: ReadonlyArray<string | number> | undefined;

  visit(
    text,
    {
      onObjectProperty(property, _offset, _length, _line, _character, getPath) {
        if (duplicatePath !== undefined) return;
        const objectPath = getPath();
        const objectKey = JSON.stringify(objectPath);
        let properties = propertiesByObject.get(objectKey);
        if (properties === undefined) {
          properties = new Set<string>();
          propertiesByObject.set(objectKey, properties);
        }
        if (properties.has(property)) {
          duplicatePath = [...objectPath, property];
          return;
        }
        properties.add(property);
      },
    },
    { allowTrailingComma: true, disallowComments: false },
  );

  if (duplicatePath !== undefined) {
    throw new InstanceConfigError(
      `Invalid ${configPath}: duplicate property at ${formatConfigPath(duplicatePath)}`,
    );
  }
}

function formatConfigPath(
  pathSegments: ReadonlyArray<string | number>,
): string {
  return pathSegments
    .map((segment, index) =>
      isNumber(segment)
        ? `[${segment}]`
        : index === 0
          ? segment
          : `.${segment}`,
    )
    .join('');
}

function offsetToLineColumn(text: string, offset: number) {
  const upToOffset = text.slice(0, offset);
  // `lastIndexOf` returns -1 when the offset is on the first line, so
  // `length - -1` is the 1-based column with no separate case. Measured
  // against the CLAMPED prefix, since an offset past the end slices short.
  return {
    line: upToOffset.split('\n').length,
    column: upToOffset.length - upToOffset.lastIndexOf('\n'),
  };
}

// ---- Schema validation --------------------------------------------------

function assertValidRaw(
  raw: UnknownRecord,
  configPath: string,
): asserts raw is RawInstanceConfig {
  const validate = getConfigValidator();
  if (validate(raw)) {
    return;
  }

  const messages = (validate.errors ?? []).map((e) => {
    const instancePath = describeInstancePath(e.instancePath, raw);
    if (e.keyword === 'additionalProperties') {
      // SAFETY: ajv's ErrorObject['params'] isn't discriminated by
      // e.keyword — its type stays a generic union regardless of the
      // runtime check above — but ajv's own docs guarantee the
      // additionalProperties keyword's params always carries this shape.
      const extra = (e.params as { additionalProperty?: string })
        .additionalProperty;
      return `${instancePath}/${extra ?? '?'}: unrecognized key`;
    }
    return `${instancePath || '/'}: ${e.message ?? 'is invalid'}`;
  });

  throw new InstanceConfigError(
    `Invalid ${configPath}:\n${messages.map((m) => `  - ${m}`).join('\n')}`,
  );
}

/**
 * Rewrite ajv's positional `/models/0/...` into `/models[<id>]/...`.
 *
 * Every hand-written `models[]` failure below already names the model id, and
 * an operator editing a long catalog reads an id far faster than an ordinal.
 * Falls back to the raw path whenever the id is not a usable string — the
 * entry being reported may be exactly the one whose `id` is missing.
 *
 * Returns ajv's path unchanged for anything else, INCLUDING the empty root
 * path: each caller applies its own default for that, because the two want
 * different ones ('' for an additionalProperties base, '/' for a message).
 */
function describeInstancePath(
  instancePath: string,
  raw: UnknownRecord,
): string {
  const match = /^\/models\/(\d+)(?<rest>\/.*)?$/.exec(instancePath);
  if (!match) {
    return instancePath;
  }
  const models: unknown = raw.models;
  if (!Array.isArray(models)) {
    return instancePath;
  }
  // Annotated `unknown`, not inferred: `Array.isArray` narrows to `any[]`, so
  // indexing it would hand the rest of this function an unchecked `any`.
  const entry: unknown = models[Number(match[1])];
  const id = isRecord(entry) ? entry.id : undefined;
  return isString(id) && id.length > 0
    ? `/models[${id}]${match.groups?.rest ?? ''}`
    : instancePath;
}

// ---- Per-leaf presence + resolution -------------------------------------

type Leaf = { present: boolean; raw: unknown };

function readLeaf(
  raw: UnknownRecord | undefined,
  group: string,
  key: string,
): Leaf {
  if (!raw) {
    return { present: false, raw: undefined };
  }
  const groupValue = raw[group];
  if (!isRecord(groupValue)) {
    return { present: false, raw: undefined };
  }
  if (!Object.hasOwn(groupValue, key)) {
    return { present: false, raw: undefined };
  }
  return { present: true, raw: groupValue[key] };
}

/** Resolve a string interpolation, translating a failure into a config-path-scoped, value-free error. */
function resolveInterpolatedString(
  raw: string,
  configPath: string,
  env: NodeJS.ProcessEnv,
): string {
  try {
    return interpolateString(raw, env);
  } catch (error) {
    if (error instanceof InterpolationError) {
      throw new InstanceConfigError(`${configPath}: ${error.message}`);
    }
    throw error;
  }
}

function resolveNullableString(opts: {
  configPath: string;
  present: boolean;
  raw: unknown;
  env: NodeJS.ProcessEnv;
}): string | null {
  const { configPath, present, raw, env } = opts;
  if (!present || raw === null) {
    // Absent (or explicit null) = unset. The environment reaches config ONLY
    // through {env:...} interpolation tokens in the file — there is no bare
    // env-var fallback (D5).
    return null;
  }
  if (!isString(raw)) {
    throw new InstanceConfigError(`${configPath}: must be a string`);
  }
  const resolved = resolveInterpolatedString(raw, configPath, env).trim();
  // Empty (or whitespace-only) resolution on a nullable key means unset.
  // Trimmed so InstanceConfigService.config hands out one normalized shape.
  return resolved === '' ? null : resolved;
}

function resolveNumeric(opts: {
  configPath: string;
  present: boolean;
  raw: unknown;
  builtInDefault: number | null;
  nullable: boolean;
  env: NodeJS.ProcessEnv;
  /**
   * Inclusive lower bound (default 1). Enforced AFTER interpolation, so an
   * `{env:...}` token that resolves below it fails with a clear config error
   * — the JSON Schema's `minimum` only constrains the literal-integer branch
   * of a `…OrToken` $def, never the token string (e.g. pg-boss's hard 10s
   * `heartbeatSeconds` floor).
   */
  min?: number;
}): number | null {
  const { configPath, present, raw, builtInDefault, nullable, env, min } = opts;

  if (!present) {
    // Absent from the file = the built-in default. The environment reaches
    // config ONLY through {env:...} interpolation tokens in the file — there
    // is no bare env-var fallback (D5).
    return builtInDefault;
  }

  if (raw === null) {
    // Unreachable while every numberOrToken/nullableNumberOrToken $def
    // excludes "null" for non-nullable settings — ajv's raw-shape
    // validation already rejects `null` on heartbeatSeconds/timeoutSeconds
    // before this branch can run.
    // Kept as defense-in-depth in case the schema and this map ever drift.
    if (!nullable) {
      throw new InstanceConfigError(
        `${configPath}: must not be null (not a nullable setting)`,
      );
    }
    return null;
  }
  if (isNumber(raw)) {
    assertPositiveInteger(raw, configPath, min);
    return raw;
  }

  // Schema validation already guaranteed `raw` is a whole-value
  // {env:...}/{path:...} token string at this point; re-check at runtime
  // rather than trust that guarantee silently.
  if (!isString(raw)) {
    throw new InstanceConfigError(
      `${configPath}: must be a number or a {env:}/{path:} token string`,
    );
  }
  return resolveNumericFromToken(raw, { configPath, env, nullable, min });
}

/** The {env:}/{path:} token-string branch of `resolveNumeric` — resolved,
 *  parsed, and range-checked separately from the already-a-number and
 *  explicit-null branches above it. */
function resolveNumericFromToken(
  raw: string,
  opts: {
    configPath: string;
    env: NodeJS.ProcessEnv;
    nullable: boolean;
    min?: number;
  },
): number | null {
  const { configPath, env, nullable, min } = opts;
  const resolved = resolveInterpolatedString(raw, configPath, env);
  if (resolved.trim() === '') {
    if (nullable) {
      return null;
    }
    throw new InstanceConfigError(
      `${configPath}: resolved to an empty value, which is not a valid number`,
    );
  }
  const n = Number(resolved);
  if (!Number.isFinite(n)) {
    throw new InstanceConfigError(
      `${configPath}: interpolated value does not resolve to a valid number`,
    );
  }
  assertPositiveInteger(n, configPath, min);
  return n;
}

/**
 * Narrows `resolveNumeric`'s `number | null` result for a call site that
 * passed `nullable: false`. `resolveNumeric` itself can still return
 * `builtInDefault` verbatim when the leaf is absent, so its return type
 * stays honest as `number | null` — this is the runtime check for callers
 * that know their own `builtInDefault` is never `null`. A `null` here means
 * that local invariant broke, not an operator config problem.
 */
function requireResolvedNumber(
  value: number | null,
  configPath: string,
): number {
  if (value === null) {
    throw new InstanceConfigError(
      `${configPath}: internal error — expected a resolved number`,
    );
  }
  return value;
}

function isStringArray(value: unknown): value is Array<string> {
  return Array.isArray(value) && value.every(isString);
}

/**
 * Resolve `tools.allowed`: absent → empty (fail closed, no tools). The
 * schema already guarantees an array of non-empty strings when present;
 * `isStringArray` re-checks it at runtime rather than trust that guarantee
 * silently. Code-owned ids remain strict against the registry; exact MCP ids
 * use the mcp-tool-id-v1 parser and namespace permissions use the single
 * canonical `mcp__<configured-server>__*` form. Neither depends on discovery
 * succeeding during boot.
 */
/** Validate ONE `tools.allowed` entry — a wildcard MCP namespace, an exact
 *  MCP tool id, or a code-owned id — against the registered tools and the
 *  configured MCP servers. Throws on the first invalid or unreferenceable id. */
function assertValidAllowlistId(
  id: string,
  configPath: string,
  configuredMcpServerIds: ReadonlySet<string>,
  registered: ReadonlySet<string>,
): void {
  if (id.includes('*')) {
    const match = /^mcp__([A-Za-z0-9_-]+)__\*$/u.exec(id);
    if (match === null || !createMcpToolId(match[1], 'x').success) {
      throw new InstanceConfigError(
        `${configPath}: invalid MCP namespace wildcard "${id}"`,
      );
    }
    if (!configuredMcpServerIds.has(match[1])) {
      throw new InstanceConfigError(
        `${configPath}: MCP namespace wildcard "${id}" references an undeclared mcpServers entry`,
      );
    }
    return;
  }
  if (id.startsWith('mcp__')) {
    const parsed = parseMcpToolId(id);
    if (!parsed.success) {
      throw new InstanceConfigError(
        `${configPath}: invalid MCP tool id "${id}"`,
      );
    }
    if (!configuredMcpServerIds.has(parsed.serverId)) {
      throw new InstanceConfigError(
        `${configPath}: MCP tool id "${id}" references an undeclared mcpServers entry`,
      );
    }
    return;
  }
  if (!registered.has(id)) {
    throw new InstanceConfigError(
      `${configPath}: unknown tool id "${id}" (not registered)`,
    );
  }
}

function resolveToolAllowlist(opts: {
  configPath: string;
  present: boolean;
  raw: unknown;
  configuredMcpServerIds: ReadonlySet<string>;
}): ReadonlyArray<string> {
  const { configPath, present, raw, configuredMcpServerIds } = opts;
  if (!present) {
    return BUILT_IN_DEFAULTS.tools.allowed;
  }
  if (!isStringArray(raw)) {
    throw new InstanceConfigError(`${configPath}: must be an array of strings`);
  }
  const registered = new Set(getRegisteredToolIds());
  for (const id of raw) {
    assertValidAllowlistId(id, configPath, configuredMcpServerIds, registered);
  }
  return raw;
}

const TRANSPORT_OWNED_MCP_HEADERS = new Set([
  'accept',
  'content-type',
  'mcp-protocol-version',
  'mcp-session-id',
  'last-event-id',
]);

function asciiCaseFold(value: string): string {
  return value.replaceAll(/[A-Z]/gu, (letter) => letter.toLowerCase());
}

function resolveRemoteMcpServer(
  serverPath: string,
  entry: Extract<RawMcpServerEntry, { type: 'http' | 'streamable-http' }>,
  env: NodeJS.ProcessEnv,
): McpRemoteServerConfig {
  const urlPath = `${serverPath}.url`;
  const resolvedUrl = resolvePrivateMcpString(entry.url, urlPath, env);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(resolvedUrl);
  } catch {
    throw new InstanceConfigError(
      `${urlPath}: must be an absolute http or https URL without userinfo`,
    );
  }
  if (
    (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') ||
    parsedUrl.username !== '' ||
    parsedUrl.password !== ''
  ) {
    throw new InstanceConfigError(
      `${urlPath}: must be an absolute http or https URL without userinfo`,
    );
  }

  const headers = resolveMcpHeaders(serverPath, entry.headers, env);
  const remoteConfig: McpRemoteServerConfig = {
    type: 'streamable-http',
    url: resolvedUrl,
  };
  if (headers !== undefined) remoteConfig.headers = headers;
  return remoteConfig;
}

function resolveMcpServers(
  raw: RawInstanceConfig | undefined,
  env: NodeJS.ProcessEnv,
) {
  const entries = raw?.mcpServers ?? {};
  const resolved: Record<string, McpServerConfig> = {};

  for (const [serverId, entry] of Object.entries(entries)) {
    const serverPath = `mcpServers.${serverId}`;
    const serverProbe = createMcpToolId(serverId, 'x');
    if (!serverProbe.success) {
      throw new InstanceConfigError(`${serverPath}: invalid server name`);
    }

    resolved[serverId] =
      entry.type === 'stdio'
        ? resolveStdioServer(serverPath, entry, env)
        : resolveRemoteMcpServer(serverPath, entry, env);
  }

  return resolved;
}

function resolvePrivateMcpString(
  raw: string,
  configPath: string,
  env: NodeJS.ProcessEnv,
): string {
  return resolvePrivateMcpValue(raw, configPath, env).value;
}

/**
 * Resolves a private MCP string and reports what its tokens resolved to, so a
 * caller can treat exactly those segments as secrets. Interpolating is how an
 * operator declares a value sensitive; literal text is never protected.
 */
function resolvePrivateMcpValue(
  raw: string,
  configPath: string,
  env: NodeJS.ProcessEnv,
): { value: string; substituted: ReadonlyArray<string> } {
  try {
    return interpolateStringWithSubstitutions(raw, env);
  } catch (error) {
    if (error instanceof InterpolationError) {
      // Value-free on purpose: the message must not carry a resolved or
      // partially resolved secret into an operator log.
      throw new InstanceConfigError(`${configPath}: interpolation failed`);
    }
    throw error;
  }
}

/**
 * Resolves a local stdio entry.
 *
 * Every `{env:…}` / `{path:…}` token across `command`, `args`, and `env`
 * contributes its resolved value to `protectedValues`; literal text never does.
 */
function resolveStdioServer(
  serverPath: string,
  entry: Extract<RawMcpServerEntry, { type: 'stdio' }>,
  env: NodeJS.ProcessEnv,
): McpStdioServerConfig {
  const protectedValues: Array<string> = [];
  const take = (raw: string, configPath: string): string => {
    const { value, substituted } = resolvePrivateMcpValue(raw, configPath, env);
    protectedValues.push(...substituted);
    return value;
  };

  // Shape is already guaranteed: `assertValidRaw` ran the closed schema over
  // this entry before resolution, same as `resolveToolAllowlist` relies on.
  // Only what the schema cannot see is re-checked below — a token resolving to
  // empty, which it never gets to observe.
  const commandPath = `${serverPath}.command`;
  const command = take(entry.command, commandPath);
  if (command.length === 0) {
    throw new InstanceConfigError(`${commandPath}: must be a non-empty string`);
  }

  const args = entry.args?.map((argument, index) =>
    take(argument, `${serverPath}.args[${index}]`),
  );

  let childEnv: Record<string, string> | undefined;
  if (entry.env !== undefined) {
    // Null-prototype, as the header path is: the schema accepts any non-empty
    // variable name, and assigning `__proto__` into a normal object hits
    // `Object.prototype`'s setter instead of creating an own property, so the
    // variable would be dropped silently on its way to the child.
    // Mutating a typed empty object's prototype in place, rather than
    // `Object.create(null)`, keeps the value typed without a cast — TS types
    // `Object.create`'s single-argument overload as `any`.
    childEnv = {};
    Object.setPrototypeOf(childEnv, null);
    for (const [name, raw] of Object.entries(entry.env)) {
      childEnv[name] = take(raw, `${serverPath}.env.${name}`);
    }
  }

  const config: McpStdioServerConfig = { type: 'stdio', command };
  if (args !== undefined) config.args = Object.freeze(args);
  if (childEnv !== undefined) config.env = Object.freeze(childEnv);
  if (entry.cwd !== undefined) config.cwd = entry.cwd;
  if (protectedValues.length > 0) {
    config.protectedValues = Object.freeze([...new Set(protectedValues)]);
  }
  return config;
}

function resolveMcpHeaders(
  serverPath: string,
  rawHeaders: Record<string, string> | undefined,
  env: NodeJS.ProcessEnv,
): Readonly<Record<string, string>> | undefined {
  if (rawHeaders === undefined) return undefined;

  const namesByFold = new Map<string, string>();
  for (const name of Object.keys(rawHeaders)) {
    const headerPath = `${serverPath}.headers.${name}`;
    const folded = asciiCaseFold(name);
    const prior = namesByFold.get(folded);
    if (prior !== undefined) {
      throw new InstanceConfigError(
        `${serverPath}.headers.${prior} and ${headerPath}: header names collide under ASCII case-folding`,
      );
    }
    if (TRANSPORT_OWNED_MCP_HEADERS.has(folded)) {
      throw new InstanceConfigError(
        `${headerPath}: transport-owned header cannot be configured`,
      );
    }
    namesByFold.set(folded, name);
  }

  // Same null-prototype construction as `resolveStdioServer`'s `childEnv`.
  const headers: Record<string, string> = {};
  Object.setPrototypeOf(headers, null);
  for (const [name, rawValue] of Object.entries(rawHeaders)) {
    const headerPath = `${serverPath}.headers.${name}`;
    const value = resolvePrivateMcpString(rawValue, headerPath, env);
    if (value.trim() === '') {
      throw new InstanceConfigError(
        `${headerPath}: must resolve to a non-empty string`,
      );
    }
    headers[name] = value;
  }
  return headers;
}

/**
 * Resolve `workers`: absent -> the built-in profiles (`all`, `web`) unchanged.
 * Present -> merged over the built-ins **per group**, not per profile: a file
 * entry for a profile name that shares a built-in (`all`/`web`) overrides only
 * the groups it names and KEEPS the rest of that built-in profile's groups.
 * So `{"all": {"runs": 2}}` raises the `runs` concurrency while leaving
 * `search-reindex`/`sessions-cleanup` running at their built-in 1 — an
 * operator tuning one group can't silently disable the others (a per-profile
 * wholesale replace would drop them). A file profile whose name has no
 * built-in base (e.g. a future `heavy`) is used as-is. To run a strict subset
 * of groups, declare a new profile name rather than narrowing `all`. Group-name
 * and concurrency-value validity is enforced by the JSON Schema's closed
 * per-profile shape — `assertValidRaw` already ran and typed `raw.workers`
 * accordingly, so no further cast is needed here.
 */
function resolveWorkerProfiles(raw: RawInstanceConfig | undefined) {
  const fileWorkers = raw?.workers;
  if (!fileWorkers) {
    return BUILT_IN_DEFAULTS.workers;
  }
  const merged = { ...BUILT_IN_DEFAULTS.workers };
  for (const [name, groups] of Object.entries(fileWorkers)) {
    merged[name] = { ...BUILT_IN_DEFAULTS.workers[name], ...groups };
  }
  return merged;
}

// ---- Providers + models (providers-and-models-as-code, #167) ------------

/**
 * Resolve `providers[]`: the schema (assertValidRaw, already run) guarantees
 * element shape (required `id`/`type`, closed properties) and typed
 * `raw.providers` accordingly — this resolver owns interpolation of
 * `key`/`baseUrl` and duplicate-id rejection. Every error names the entry's
 * `id` and field, never the resolved value (same secret discipline as the
 * scalar loader's `{env:}`/`{path:}` resolution).
 */
function resolveProviders(
  raw: RawInstanceConfig | undefined,
  env: NodeJS.ProcessEnv,
): Array<ProviderConfig> {
  const entries = raw?.providers ?? [];
  const seenIds = new Set<string>();

  return entries.map((entry) => {
    if (seenIds.has(entry.id)) {
      throw new InstanceConfigError(
        `providers: duplicate provider id "${entry.id}"`,
      );
    }
    seenIds.add(entry.id);

    return {
      id: entry.id,
      type: entry.type,
      // Same absent/null/empty-means-unset semantics as every other nullable
      // string setting — no separate helper needed, just an explicit
      // per-element path label (there is no top-level group/key leaf here).
      key: resolveNullableString({
        configPath: `providers[${entry.id}].key`,
        present: entry.key !== undefined,
        raw: entry.key,
        env,
      }),
      baseUrl: resolveNullableString({
        configPath: `providers[${entry.id}].baseUrl`,
        present: entry.baseUrl !== undefined,
        raw: entry.baseUrl,
        env,
      }),
    };
  });
}

/**
 * Resolve `models[]`: the schema guarantees required-field presence and
 * element shape; this resolver owns duplicate-id rejection and the
 * `provider` cross-reference (models[].provider must name a defined
 * providers[].id — not expressible in JSON Schema, which can't reference
 * across sibling arrays).
 */
/** Shared across every `models[]` entry in one `resolveModels` call —
 *  `seenIds` is mutated in place to detect a duplicate id across entries. */
type ModelResolutionContext = {
  readonly env: NodeJS.ProcessEnv;
  readonly providerIds: ReadonlySet<string>;
  readonly promptLoader: ReturnType<typeof createModelPromptLoader>;
  readonly seenIds: Set<string>;
};

function resolveContextWindowTokens(
  modelId: string,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- passed straight through to `resolveNumeric`, which validates it via its own `present`/`raw` shape checks; not itself a validating check.
  raw: unknown,
  env: NodeJS.ProcessEnv,
): number {
  return requireResolvedNumber(
    resolveNumeric({
      configPath: `models[${modelId}].contextWindowTokens`,
      present: true,
      raw,
      builtInDefault: null,
      nullable: false,
      env,
    }),
    `models[${modelId}].contextWindowTokens`,
  );
}

function resolveOptionalCompactionThreshold(
  modelId: string,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- validated by the equality guard `raw === undefined` below; not an `isXxx`-named predicate, a shape the structural exemption doesn't recognize. `resolveNumeric` below re-validates the resolved shape regardless.
  raw: unknown,
  env: NodeJS.ProcessEnv,
): number | undefined {
  if (raw === undefined) return undefined;
  return requireResolvedNumber(
    resolveNumeric({
      configPath: `models[${modelId}].compactionThresholdTokens`,
      present: true,
      raw,
      builtInDefault: null,
      nullable: false,
      env,
    }),
    `models[${modelId}].compactionThresholdTokens`,
  );
}

function assertValidModelEntry(
  entry: RawModelEntry,
  context: ModelResolutionContext,
): void {
  const { providerIds, seenIds } = context;
  if (seenIds.has(entry.id)) {
    throw new InstanceConfigError(`models: duplicate model id "${entry.id}"`);
  }
  seenIds.add(entry.id);

  if (!providerIds.has(entry.provider)) {
    throw new InstanceConfigError(
      `models[${entry.id}].provider: unknown provider id "${entry.provider}" (not defined in providers[])`,
    );
  }
}

function resolveModelEntry(
  entry: RawModelEntry,
  context: ModelResolutionContext,
): SystemModelCatalogEntry {
  assertValidModelEntry(entry, context);
  const { env, promptLoader } = context;

  // The remaining fields (pricingUsdPer1M, name, description, tags, icon,
  // knowledgeCutoff, website, apiDocs, modelPage, releasedAt) are plain
  // pass-through display metadata — schema-validated shape already
  // guarantees they need no further resolution, so they ride along in the
  // spread below rather than each needing its own presence check.
  const {
    contextWindowTokens: rawContextWindowTokens,
    compactionThresholdTokens: rawCompactionThresholdTokens,
    systemPromptFile,
    reasoning: rawReasoning,
    ...display
  } = entry;

  const reasoning = resolveModelReasoning(entry.id, rawReasoning);
  const contextWindowTokens = resolveContextWindowTokens(
    entry.id,
    rawContextWindowTokens,
    env,
  );
  const compactionThresholdTokens = resolveOptionalCompactionThreshold(
    entry.id,
    rawCompactionThresholdTokens,
    env,
  );

  const prompt = promptLoader.resolve({
    id: entry.id,
    ...(entry.name !== undefined && { name: entry.name }),
    ...(systemPromptFile !== undefined && { systemPromptFile }),
  });

  return {
    ...display,
    source: 'system' as const,
    contextWindowTokens,
    ...prompt,
    ...(compactionThresholdTokens !== undefined && {
      compactionThresholdTokens,
    }),
    ...(reasoning !== undefined && { reasoning }),
  };
}

function resolveModels(
  raw: RawInstanceConfig | undefined,
  env: NodeJS.ProcessEnv,
  providerIds: ReadonlySet<string>,
  promptLoader: ReturnType<typeof createModelPromptLoader>,
): Array<SystemModelCatalogEntry> {
  const entries = raw?.models ?? [];
  const context: ModelResolutionContext = {
    env,
    providerIds,
    promptLoader,
    seenIds: new Set<string>(),
  };
  return entries.map((entry) => resolveModelEntry(entry, context));
}

/**
 * Resolve one entry's `reasoning` block. The schema admits bare strings and
 * `{ value, label }` objects; this normalizes to `{ value, label? }[]` and
 * owns uniqueness / blank / `defaultEffort` membership on `value` — rules
 * JSON Schema cannot express across the mixed item form.
 *
 * Values are passed through untouched — no trimming, casing, sorting, or
 * rewriting. They are opaque provider tokens, and normalizing one here would
 * silently send the provider a value the operator did not configure.
 */
/** Validate and normalize ONE `effortLevels[]` item — a bare string or a
 *  `{ value, label }` object — mutating `seen` in place to detect a
 *  duplicate `value` across the whole list. Values are passed through
 *  untouched (see `resolveModelReasoning`'s own doc comment); `minLength: 1`
 *  only rejects the empty string, so `trim()` here is the TEST, never a
 *  transformation — a padded-but-nonblank token stays byte-for-byte. */
function resolveEffortLevel(
  modelId: string,
  index: number,
  item: string | { readonly value: string; readonly label: string },
  seen: Set<string>,
): EffortLevel {
  const value = isString(item) ? item : item.value;
  const label = isString(item) ? undefined : item.label;

  if (value.trim() === '') {
    throw new InstanceConfigError(
      `models[${modelId}].reasoning.effortLevels[${index}]: must not be blank`,
    );
  }
  if (label !== undefined && label.trim() === '') {
    throw new InstanceConfigError(
      `models[${modelId}].reasoning.effortLevels[${index}].label: must not be blank`,
    );
  }
  if (seen.has(value)) {
    throw new InstanceConfigError(
      `models[${modelId}].reasoning.effortLevels[${index}]: duplicate value "${value}"`,
    );
  }
  seen.add(value);
  return isString(item)
    ? { value: item }
    : { value: item.value, label: item.label };
}

function resolveModelReasoning(
  modelId: string,
  raw: RawModelEntry['reasoning'],
): ModelReasoning | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const seen = new Set<string>();
  const effortLevels = raw.effortLevels.map((item, index) =>
    resolveEffortLevel(modelId, index, item, seen),
  );

  if (!seen.has(raw.defaultEffort)) {
    throw new InstanceConfigError(
      `models[${modelId}].reasoning.defaultEffort: "${raw.defaultEffort}" is not one of effortLevels [${[...seen].join(', ')}]`,
    );
  }

  return {
    effortLevels,
    defaultEffort: raw.defaultEffort,
    cacheInvalidatedByEffortChange: raw.cacheInvalidatedByEffortChange ?? false,
  };
}

/**
 * Resolve `embeddingModels[]` (chat-search-embeddings, design D1): the
 * schema guarantees required-field presence and element shape; this resolver
 * owns duplicate-id rejection and the `provider` cross-reference — the same
 * split `resolveModels` uses, and for the same reason (not expressible in
 * JSON Schema, which can't reference across sibling arrays). Every error
 * names the entry by id and field, never by resolved value.
 */
function resolveEmbeddingModels(
  raw: RawInstanceConfig | undefined,
  env: NodeJS.ProcessEnv,
  providerIds: ReadonlySet<string>,
): Array<EmbeddingModelCatalogEntry> {
  const entries = raw?.embeddingModels ?? [];
  const seenIds = new Set<string>();

  return entries.map((entry) => {
    if (seenIds.has(entry.id)) {
      throw new InstanceConfigError(
        `embeddingModels: duplicate embedding model id "${entry.id}"`,
      );
    }
    seenIds.add(entry.id);

    if (!providerIds.has(entry.provider)) {
      throw new InstanceConfigError(
        `embeddingModels[${entry.id}].provider: unknown provider id "${entry.provider}" (not defined in providers[])`,
      );
    }

    // dimensions/id/provider/providerModelId presence+shape are schema-
    // guaranteed; revision/documentPrefix/queryPrefix need no resolution
    // (no {env:}/{path:} interpolation on this entry — same posture as
    // models[]'s display fields) so they ride along in the spread rather
    // than each needing its own presence check.
    return {
      ...entry,
      batchSize: entry.batchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE,
      distanceMetric: entry.distanceMetric ?? 'cosine',
    };
  });
}

/**
 * Resolve `search`: per-corpus intended-embedding-model selection (design
 * D6). `chats` is the only corpus this change embeds. Absent -> no intended
 * model, no embedding work (off-by-default).
 */
function resolveSearchConfig(
  raw: RawInstanceConfig | undefined,
  env: NodeJS.ProcessEnv,
  embeddingModelIds: ReadonlySet<string>,
): LlameConfig['search'] {
  const chatsEmbeddingModelId = resolveNullableString({
    configPath: 'search.chats.embeddingModelId',
    ...readLeaf(raw?.search, 'chats', 'embeddingModelId'),
    env,
  });
  assertReferencesCatalog(
    'search.chats.embeddingModelId',
    chatsEmbeddingModelId,
    embeddingModelIds,
    'embeddingModels[].id',
  );
  return {
    chats: { embeddingModelId: chatsEmbeddingModelId },
  };
}

/**
 * Boot-time reference integrity for a nullable pointer setting that must name
 * an entry in some other resolved catalog (`defaults.modelId` /
 * `defaults.titleGenerationModelId` against `models[].id` — D6; `search.
 * chats.embeddingModelId` against `embeddingModels[].id`), or startup fails
 * naming the dangling reference. `null` (unset) is always valid — these
 * pointers are optional.
 */
function assertReferencesCatalog(
  configPath: string,
  id: string | null,
  ids: ReadonlySet<string>,
  catalogLabel: string,
): void {
  // Never interpolate the resolved id into the message: these pointers
  // support {env:}/{path:} interpolation like any nullable string setting, so
  // a dangling reference here could otherwise leak a resolved secret value
  // (same discipline as InterpolationError — name the path, never the value).
  if (id !== null && !ids.has(id)) {
    throw new InstanceConfigError(
      `${configPath}: does not reference any configured ${catalogLabel}`,
    );
  }
}

/**
 * Positivity/integer bound for all four numeric settings (literal or
 * interpolated-and-coerced): a file that says `"timeoutSeconds": -5` is
 * exactly the misconfiguration this feature exists to catch at boot, so it
 * fails loud rather than falling back.
 */
function assertPositiveInteger(n: number, configPath: string, min = 1): void {
  if (!Number.isInteger(n) || n < min) {
    throw new InstanceConfigError(
      min === 1
        ? `${configPath}: must be a positive integer`
        : `${configPath}: must be an integer >= ${min}`,
    );
  }
}
