import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import Handlebars from 'handlebars';

/** Read access to one prompt file. Injectable so tests can substitute fixture
 *  trees, and so a worker's operator prompts can be probed without touching the
 *  real filesystem. */
export type PromptFileAccess = {
  isFile(filePath: string): boolean;
  readFile(filePath: string): string;
};

export const DEFAULT_PROMPT_FILE_ACCESS: PromptFileAccess = {
  isFile: (filePath) => statSync(filePath).isFile(),
  readFile: (filePath) => readFileSync(filePath, 'utf8'),
};

/**
 * The one normalization every prompt source gets, whether an operator wrote it
 * or llame ships it: CRLF and lone CR become LF, then whitespace after the last
 * content is dropped. That makes a file-final newline harmless; interior blank
 * lines are render-relevant and survive.
 */
function normalizePromptSource(raw: string): string {
  return raw.replaceAll(/\r\n?/gu, '\n').replace(/\s+$/u, '');
}

/**
 * Reads one prompt source through `access` and normalizes it.
 *
 * A read failure propagates unchanged, and an empty result is returned as
 * empty: the operator loader maps both to its own field-scoped diagnostics, and
 * a packaged file names the resolved path instead. This module never throws
 * another layer's error type.
 */
export function readPromptSource(
  filePath: string,
  access: PromptFileAccess,
): string {
  return normalizePromptSource(access.readFile(filePath));
}

/**
 * Prompt templates render through their own Handlebars environment so that no
 * helper or partial registered anywhere else in the process is reachable from a
 * prompt file.
 *
 * `Handlebars.create()` shares `Utils` **by reference** with the global export,
 * so `Utils.escapeExpression` MUST NOT be replaced here — patching it would
 * change escaping for every other handlebars consumer in the process. Values
 * are escaped when the context is built instead (`escapeForPrompt`).
 *
 * ONE environment for every regime, packaged templates included: a `SafeString`
 * is recognized only by the environment that compiled the template rendering
 * it, so a second `create()` would escape every projected value a second time.
 */
const promptTemplates = Handlebars.create();

/** Narrower than handlebars' default, which also mangles `'`, `"`, `=`, and backticks. */
const PROMPT_ESCAPES = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
]);

export function escapeForPrompt(value: string): string {
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
 * A value already neutralized and wrapped for a render. The ONLY shape a prompt
 * context value may take: handlebars recognizes it as content to emit verbatim,
 * which is what keeps the shared environment from escaping a projected value a
 * second time.
 */
export type PromptSafeValue = Handlebars.SafeString;

/**
 * Wraps an already-neutralized value so handlebars renders it verbatim. The one
 * way to construct a prompt `SafeString`, for the shared-environment reason on
 * `promptTemplates` — and the reason a packaged template's view values are
 * SafeStrings too even though its compilation disables escaping.
 */
export function promptSafeString(value: string): PromptSafeValue {
  return new promptTemplates.SafeString(value);
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
export function promptValue(
  raw: string | undefined,
  neutralize: (value: string) => string = escapeForPrompt,
): PromptSafeValue | undefined {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  return promptSafeString(neutralize(trimmed));
}

/** Which escaping a source is compiled under. Operator files take handlebars'
 *  default HTML escaping (they still pass no options object); packaged files
 *  compile with `noEscape`, because llame's own prose is model-facing text in
 *  which an authored `<tag>` is intentional. */
type PromptEscapeRegime = 'operator' | 'packaged';

/**
 * Compiled templates, keyed by their SOURCE rather than by file path.
 *
 * The catalog carries prompt templates as plain strings, so compilation has to
 * happen on the render path; doing it per run would re-parse the template on
 * every message. Keying on source means several models pointing at one file
 * share a compile, and it stays correct when the same text arrives from
 * somewhere else entirely (a test fixture, say).
 *
 * The escape regime is part of the key because `noEscape` is baked in at
 * COMPILE time: a source-only key would serve whichever compilation ran first
 * to the other regime, silently changing the bytes one of them renders.
 *
 * Bounded by the number of distinct prompt files in the operator's config,
 * which is config-as-code read once at boot — not an unbounded cache over user
 * input. Packaged templates add one fixed entry per file at import.
 */
const compiledTemplates = new Map<string, HandlebarsTemplateDelegate>();

function compileSource(
  source: string,
  regime: PromptEscapeRegime,
): HandlebarsTemplateDelegate {
  const key = `${regime}\0${source}`;
  const cached = compiledTemplates.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const compiled =
    regime === 'packaged'
      ? promptTemplates.compile(source, { noEscape: true })
      : promptTemplates.compile(source);
  compiledTemplates.set(key, compiled);
  return compiled;
}

/** Compiles one operator template, memoized per source. */
export function compilePromptTemplate(
  source: string,
): HandlebarsTemplateDelegate {
  return compileSource(source, 'operator');
}

/**
 * Parses one template for the strict validator. A parse failure propagates
 * unchanged: the operator loader reports it against the file's config field, so
 * this module neither diagnoses nor rewrites it.
 */
export function parsePromptTemplate(source: string): hbs.AST.Program {
  return promptTemplates.parse(source);
}

/** Renders one packaged template from its producer's own values. */
export type PackagedTemplateRenderer<TValues extends object> = (
  values: TValues,
) => string;

/**
 * Loads one packaged prompt template: `<directory>/prompts/<name>.md`, where
 * `directory` is the producing module's `__dirname`.
 *
 * Reads and compiles EAGERLY, so a missing, empty, or malformed template fails
 * at import rather than as a silently empty model-facing body on the first
 * render. It does not go through the strict validator, take an override, or run
 * a boot probe: llame authors both the file and the values it renders, and no
 * configuration can replace it.
 */
export function loadPackagedTemplate<TValues extends object>(
  directory: string,
  name: string,
): PackagedTemplateRenderer<TValues> {
  const filePath = path.resolve(directory, 'prompts', `${name}.md`);
  const source = readPackagedSource(filePath, name);
  const template = compileSource(source, 'packaged');
  return (values) => template(values);
}

function readPackagedSource(filePath: string, name: string): string {
  if (!statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(
      `Packaged prompt template missing: ${name} (expected ${filePath})`,
    );
  }
  const source = readPromptSource(filePath, DEFAULT_PROMPT_FILE_ACCESS);
  if (source.length === 0) {
    throw new Error(`Packaged prompt template empty: ${filePath}`);
  }
  return source;
}
