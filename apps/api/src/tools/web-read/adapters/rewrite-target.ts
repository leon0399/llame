export type RewriteTarget = {
  /** Declared origin, e.g. 'https://x.pcstyle.dev'. */
  readonly origin: string;
  /** Literal path text before the first placeholder (at least '/'). */
  readonly pathPrefix: string;
  /** Original template text after the declared origin. */
  readonly template: string;
};

type RewriteTargetError = { readonly error: string };
type TemplateValidation = { readonly pathPrefix: string } | RewriteTargetError;
type ParsedTargetOrigin =
  | { readonly origin: URL; readonly template: string }
  | RewriteTargetError;

const SCHEME = /^(https?):\/\//iu;
const UNKNOWN_PLACEHOLDER = /\{[^{}]*\}/u;

function invalidTarget(error: string) {
  return { error } satisfies RewriteTargetError;
}

function findAuthorityEnd(target: string, schemeEnd: number): number {
  const relative = target.slice(schemeEnd).search(/[/?{]/u);
  return relative === -1 ? target.length : schemeEnd + relative;
}

function authorityPlaceholderError(
  target: string,
  authorityEnd: number,
  authority: string,
): RewriteTargetError | undefined {
  if (target[authorityEnd] !== '{') return undefined;
  if (authority.length === 0 || authority.endsWith(':')) {
    return invalidTarget(
      'placeholders are not allowed in scheme, host, or port',
    );
  }
  const pathEnd = authorityEnd + '{path}'.length;
  if (!target.startsWith('{path}', authorityEnd)) {
    return invalidTarget('authority placeholder must be {path}');
  }
  const following = target[pathEnd];
  if (
    following !== undefined &&
    following !== '/' &&
    following !== '?' &&
    following !== '{'
  ) {
    return invalidTarget(
      'authority {path} placeholder must be followed by a path delimiter',
    );
  }
  return undefined;
}

function pathPrefixForTemplate(origin: URL, pathTemplate: string): string {
  const firstPlaceholder = pathTemplate.indexOf('{');
  const literalPrefix =
    firstPlaceholder === -1
      ? pathTemplate
      : pathTemplate.slice(0, firstPlaceholder);
  return new URL(`${origin.origin}${literalPrefix || '/'}`).pathname;
}

function validatePlaceholderSegment(
  segment: string,
  allowPath: boolean,
): RewriteTargetError | undefined {
  if (!allowPath && segment.includes('{path}')) {
    return invalidTarget('{path} is allowed only in the path portion');
  }
  const allowed = allowPath
    ? segment.replaceAll(/\{path\}|\{query\}/gu, '')
    : segment.replaceAll('{query}', '');
  if (!/[{}]/u.test(allowed)) return undefined;
  const unknown = UNKNOWN_PLACEHOLDER.exec(allowed);
  return unknown === null
    ? invalidTarget('unbalanced placeholder brace')
    : invalidTarget(`unknown placeholder "${unknown[0]}"`);
}

function validateTemplate(
  pathTemplate: string,
  queryTemplate: string | undefined,
  origin: URL,
): TemplateValidation {
  const pathError = validatePlaceholderSegment(pathTemplate, true);
  if (pathError !== undefined) return pathError;
  if (queryTemplate !== undefined) {
    const queryError = validatePlaceholderSegment(queryTemplate, false);
    if (queryError !== undefined) return queryError;
  }
  return { pathPrefix: pathPrefixForTemplate(origin, pathTemplate) };
}

function parseTargetOrigin(target: string): ParsedTargetOrigin {
  if (target.includes('\\')) {
    return invalidTarget('target must not contain backslashes');
  }
  if (target.includes('#')) {
    return invalidTarget('target must not contain a fragment');
  }
  const schemeMatch = SCHEME.exec(target);
  if (schemeMatch === null) {
    return invalidTarget('target must be an absolute http or https URL');
  }
  const schemeEnd = schemeMatch[0].length;
  const authorityEnd = findAuthorityEnd(target, schemeEnd);
  const authority = target.slice(schemeEnd, authorityEnd);
  const placeholderError = authorityPlaceholderError(
    target,
    authorityEnd,
    authority,
  );
  if (placeholderError !== undefined) return placeholderError;
  if (authority.includes('@')) {
    return invalidTarget('target must not contain userinfo');
  }

  const originText = target.slice(0, authorityEnd);
  let origin: URL;
  try {
    origin = new URL(originText);
  } catch {
    return invalidTarget('target has an invalid URL origin');
  }
  return { origin, template: target.slice(authorityEnd) };
}

/**
 * Parse and validate one operator-authored rewrite template. The authority is
 * parsed separately from the path/query template so a placeholder can never be
 * mistaken for a URL host or port.
 */
export function parseRewriteTarget(
  target: string,
): RewriteTarget | { readonly error: string } {
  const parsedOrigin = parseTargetOrigin(target);
  if ('error' in parsedOrigin) return parsedOrigin;
  const queryIndex = parsedOrigin.template.indexOf('?');
  const pathTemplate = parsedOrigin.template;
  const queryTemplate =
    queryIndex === -1 ? undefined : parsedOrigin.template.slice(queryIndex + 1);
  const validation = validateTemplate(
    pathTemplate,
    queryTemplate,
    parsedOrigin.origin,
  );
  if ('error' in validation) return validation;
  return {
    origin: parsedOrigin.origin.origin,
    pathPrefix: validation.pathPrefix,
    template: parsedOrigin.template,
  };
}

function replacePlaceholders(template: string, source: URL): string {
  return template.replaceAll(/\{path\}|\{query\}/gu, (placeholder) =>
    placeholder === '{path}'
      ? source.pathname
      : encodeURIComponent(source.search.slice(1)),
  );
}

/**
 * Expand a previously validated template for one source URL. The final URL is
 * parsed again and checked against the declared origin and literal path prefix
 * so a template cannot redirect an adapter request elsewhere.
 */
export function expandRewriteTarget(
  target: RewriteTarget,
  source: URL,
): string | undefined {
  const expanded = `${target.origin}${replacePlaceholders(target.template, source)}`;
  let url: URL;
  try {
    url = new URL(expanded);
  } catch {
    return undefined;
  }
  if (
    url.origin !== target.origin ||
    !url.pathname.startsWith(target.pathPrefix)
  ) {
    return undefined;
  }
  return url.href;
}
