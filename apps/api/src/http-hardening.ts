import type { NestExpressApplication } from '@nestjs/platform-express';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head'] as const;

/** Swagger UI's page needs its own scripts and styles. */
const DOCS_PREFIX = '/docs';

/**
 * Response headers for a JSON API that no browser should render, frame, or
 * sniff. Swagger UI under `/docs` keeps only the framing ban, since its page
 * runs scripts. A handler that sets its own policy (media files) overrides
 * these.
 */
function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    req.path.startsWith(DOCS_PREFIX)
      ? "frame-ancestors 'none'"
      : "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  next();
}

type PathMethods = {
  pattern: RegExp;
  parameters: number;
  methods: ReadonlySet<string>;
};

function templatePattern(template: string): RegExp {
  const source = template
    .split(/(\{[^}]+\})/)
    .map((piece) =>
      piece.startsWith('{')
        ? '[^/]+'
        : piece.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`),
    )
    .join('');
  return new RegExp(`^${source}/?$`);
}

/** Each documented path template with the methods it declares; HEAD comes
 *  with GET, as Express answers it. */
function documentedMethods(document: OpenAPIObject): Array<PathMethods> {
  return Object.entries(document.paths).map(([template, item]) => {
    const methods = new Set(
      HTTP_METHODS.flatMap((method) =>
        method in item ? [method.toUpperCase()] : [],
      ),
    );
    if (methods.has('GET')) methods.add('HEAD');
    return {
      pattern: templatePattern(template),
      parameters: template.split('{').length - 1,
      methods,
    };
  });
}

/**
 * The methods a path allows, from the most specific documented templates it
 * matches: `/chats/search` also matches `/chats/{id}`, but it names the search,
 * not a chat. `undefined` for a path the API does not serve.
 */
function allowedMethods(
  routes: ReadonlyArray<PathMethods>,
  path: string,
): ReadonlySet<string> | undefined {
  const matches = routes.filter((route) => route.pattern.test(path));
  if (matches.length === 0) return undefined;
  const fewest = Math.min(...matches.map((route) => route.parameters));
  return new Set(
    matches
      .filter((route) => route.parameters === fewest)
      .flatMap((route) => [...route.methods]),
  );
}

/**
 * Answers a method the API does not declare for a path it serves with 405 and
 * an `Allow` header (RFC 9110 §15.5.6), instead of the router's 404. OPTIONS
 * stays with CORS, and paths outside the document fall through untouched.
 */
export function rejectUndeclaredMethods(
  document: OpenAPIObject,
): (req: Request, res: Response, next: NextFunction) => void {
  const routes = documentedMethods(document);
  return (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    const allowed = allowedMethods(routes, req.path);
    if (allowed === undefined || allowed.has(req.method)) return next();
    res
      .status(405)
      .setHeader('Allow', [...allowed].join(', '))
      .json({
        statusCode: 405,
        error: 'Method Not Allowed',
        message: `${req.method} is not allowed on this path.`,
      });
  };
}

/**
 * Every response leaves without the framework banner and with the browser
 * hardening headers. Registered before any route, Swagger UI's included.
 */
export function secureResponses(app: NestExpressApplication): void {
  app.disable('x-powered-by');
  app.use(securityHeaders);
}
