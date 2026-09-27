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
const PLACEHOLDER = /\{([^{}]*)\}/gu;

function invalidTarget(error: string) {
  return { error } satisfies RewriteTargetError;
}

function findAuthorityEnd(target: string, schemeEnd: number): number {
  const slash = target.indexOf('/', schemeEnd);
  const query = target.indexOf('?', schemeEnd);
  const normalEnd =
    slash === -1
      ? query === -1
        ? target.length
        : query
      : query === -1
        ? slash
        : Math.min(slash, query);
  const opening = target.indexOf('{', schemeEnd);
  if (opening === -1 || opening >= normalEnd) return normalEnd;
  const authority = target.slice(schemeEnd, opening);
  // A brace directly after `//`, or after the authority's port separator,
  // cannot begin a path template.
  return authority.length > 0 && !authority.endsWith(':') ? opening : normalEnd;
}

function pathPrefixForTemplate(
  pathTemplate: string,
  queryTemplate: string | undefined,
): string {
  const firstPlaceholder = PLACEHOLDER.exec(
    queryTemplate === undefined
      ? pathTemplate
      : `${pathTemplate}?${queryTemplate}`,
  );
  PLACEHOLDER.lastIndex = 0;
  const firstPlaceholderIndex = firstPlaceholder?.index ?? -1;
  const pathPrefix =
    firstPlaceholderIndex === -1
      ? pathTemplate || '/'
      : pathTemplate.slice(0, firstPlaceholderIndex);
  return pathPrefix === '' ? '/' : pathPrefix;
}

function validatePlaceholderSegment(
  segment: string,
  allowPath: boolean,
): RewriteTargetError | undefined {
  let cursor = 0;
  while (cursor < segment.length) {
    const opening = segment.indexOf('{', cursor);
    const closing = segment.indexOf('}', cursor);
    if (closing !== -1 && (opening === -1 || closing < opening)) {
      return invalidTarget('unbalanced placeholder brace');
    }
    if (opening === -1) return undefined;
    const end = segment.indexOf('}', opening + 1);
    if (end === -1) return invalidTarget('unbalanced placeholder brace');
    const name = segment.slice(opening + 1, end);
    if (name === 'path' && !allowPath) {
      return invalidTarget('{path} is allowed only in the path portion');
    }
    if (name !== 'path' && name !== 'query') {
      return invalidTarget(`unknown placeholder "{${name}}"`);
    }
    cursor = end + 1;
  }
  return undefined;
}

function validateTemplate(
  pathTemplate: string,
  queryTemplate: string | undefined,
): TemplateValidation {
  const pathError = validatePlaceholderSegment(pathTemplate, true);
  if (pathError !== undefined) return pathError;
  if (queryTemplate !== undefined) {
    const queryError = validatePlaceholderSegment(queryTemplate, false);
    if (queryError !== undefined) return queryError;
  }
  return { pathPrefix: pathPrefixForTemplate(pathTemplate, queryTemplate) };
}

function parseTargetOrigin(target: string): ParsedTargetOrigin {
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
  if (authority.includes('{')) {
    return invalidTarget(
      'placeholders are not allowed in scheme, host, or port',
    );
  }
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
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
    return invalidTarget('target must be an absolute http or https URL');
  }
  if (origin.username !== '' || origin.password !== '') {
    return invalidTarget('target must not contain userinfo');
  }
  return { origin, template: target.slice(authorityEnd) };
}

function validateExpandedTemplate(
  origin: URL,
  template: string,
): RewriteTargetError | undefined {
  const sampleTemplate = template.replaceAll(
    /\{path\}|\{query\}/gu,
    (placeholder) => (placeholder === '{path}' ? '/' : 'query'),
  );
  try {
    const sampleUrl = new URL(`${origin.origin}${sampleTemplate}`);
    if (sampleUrl.origin !== origin.origin) {
      return invalidTarget('target template must keep the declared origin');
    }
  } catch {
    return invalidTarget('target template produces an invalid URL');
  }
  return undefined;
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
  const pathTemplate =
    queryIndex === -1
      ? parsedOrigin.template
      : parsedOrigin.template.slice(0, queryIndex);
  const queryTemplate =
    queryIndex === -1 ? undefined : parsedOrigin.template.slice(queryIndex + 1);
  const validation = validateTemplate(pathTemplate, queryTemplate);
  if ('error' in validation) return validation;
  const expansionError = validateExpandedTemplate(
    parsedOrigin.origin,
    parsedOrigin.template,
  );
  if (expansionError !== undefined) return expansionError;
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
