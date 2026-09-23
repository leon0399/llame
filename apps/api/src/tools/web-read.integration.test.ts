import {
  createServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import { type Socket } from 'node:net';

import { isString } from '@workspace/runtime-safety';

import { PORTABLE_TOOL_PERMISSIONS } from '../testing/portable-tool-policy';
import { nativeReadTool } from './native-files';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { REJECTED_ADDRESS_MESSAGE } from './permissions/messages';
import { type CompiledPolicy } from './permissions/types';
import { type ToolContext, type ToolResult } from './types';
import {
  createWebReadExecutor,
  realWebReadDeps,
  type WebReadExecutor,
} from './web-read/execute';
import { type ResolvedAddress, type ResolveHost } from './web-read/http-client';

/** The instance identity a web read sends, asserted on the fixture's side. */
const USER_AGENT = 'llame/0.0.0-test';

const MARKDOWN_BODY =
  '# Adapter pipelines\n\nServed by the publisher for agents.\n';
const MOVED_BODY = '# Moved\n\nServed at the redirect target.\n';
const PLAIN_BODY = 'Adapter pipelines\n\nServed as plain text for agents.\n';
const JSON_BODY = '{"adapter":"markdown","requests":1}';
const NOT_FOUND_BODY = 'The fixture has no such page.';
const ADDRESS_BODY = '# Address fixture\n\nServed from an admitted address.\n';
const RATE_LIMIT_BODY = 'Too many requests for this fixture.';
const PDF_BODY = '%PDF-1.7\n% fixture body\n';
const REDIRECT_LOCATION = '/moved-target';

/** The 5 MiB cap, streamed without a declared length: only a client that
 *  counts bytes as they arrive can refuse this body, so a declared-length
 *  short circuit cannot make this case pass. */
const OVERSIZED_BYTES = 6 * 1024 * 1024;
const OVERSIZED_CHUNK_BYTES = 64 * 1024;

/** Admits every derived locator, so a redirect case exercises the hop loop
 *  rather than the operator's own rules. */
const ADMIT_EVERY_LOCATOR = compileToolPermissionMap(
  { read: { allow: true } },
  'test-policy',
);

/** Admits the redirecting locator and nothing else, so the hop it names is
 *  refused by a `read` rule exactly as the example configuration would. */
const REFUSE_HOP_TARGET = compileToolPermissionMap(
  {
    read: {
      allow: [
        {
          field: 'path',
          regex: String.raw`^http://127\.0\.0\.1:\d+/redirect$`,
        },
      ],
    },
  },
  'test-policy',
);

/** Admits exactly the pages the refused-probe case submits, so every locator
 *  the pipeline derives from one of them — its announced alternate, its `.md`
 *  sibling, its `llms.txt` candidates — is refused by the same `read` rule,
 *  exactly as an operator's path clause would refuse it. */
const ADMIT_PAGE_ONLY = compileToolPermissionMap(
  {
    read: {
      allow: [
        {
          field: 'path',
          regex: String.raw`^http://127\.0\.0\.1:\d+/(?:announced|suffix|guides/adapter-pipelines)$`,
        },
      ],
    },
  },
  'test-policy',
);

/** The documented cleartext policy, compiled just as operators' maps are. */
const PORTABLE_READ_POLICY = compileToolPermissionMap(
  PORTABLE_TOOL_PERMISSIONS,
  'portable-test-policy',
);

/** Served when a request did not rank `text/markdown` first, so a read that
 *  failed to negotiate renders this instead of the Markdown body. */
const NEGOTIATION_FALLBACK_HTML =
  '<!doctype html><html><head><title>Fallback</title></head><body><p>This document was served as HTML because the request did not rank text/markdown above text/html.</p></body></html>';

/** The spike fixture: header, nav, footer, prose, a GFM table, a fenced code
 *  block, and links — the shape a rendered article must keep and drop. */
const ARTICLE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Adapter pipelines for agent web reads - Fixture Docs</title></head><body>
<header><p>HEADER SENTINEL: this masthead must not reach the render.</p></header>
<nav><a href="/guides">NAV SENTINEL: Guides</a><a href="/reference">NAV SENTINEL: Reference</a></nav>
<main><article><h1>Adapter pipelines for agent web reads</h1>
<p class="byline">By <a href="/authors/dana">Dana Reyes</a>, published for the fixture.</p>
<p>A web read prefers what a publisher already offers for agents before paying for a local conversion. This fixture article exists so the whole tool path can run against a real socket instead of an injected fetch double.</p>
<h2 id="negotiation">Negotiation</h2>
<p>The first request sends an Accept header that ranks text/markdown above text/html, so a publisher that serves Markdown for agents is taken as served.</p>
<blockquote><p>Serving markdown is both higher fidelity and cheaper than any HTML conversion the tool could perform locally.</p></blockquote>
<h2 id="render">Local render</h2>
<p>Only after the publisher-provided options are exhausted does the tool extract the main content locally, convert it with Turndown, and report which adapter produced the rendered text.</p>
<table><thead><tr><th>Adapter</th><th>Body type</th><th>Requests</th></tr></thead><tbody>
<tr><td>Negotiation</td><td>text/markdown</td><td>1</td></tr>
<tr><td>Local render</td><td>text/html</td><td>1</td></tr>
<tr><td>Raw fallback</td><td>text/html</td><td>1</td></tr>
</tbody></table>
<pre><code>const article = new Readability(document).parse();</code></pre>
<p>The result reports the winning method so an operator can tell a negotiated body from a local render. Read the <a href="/reference/read">read reference</a> for every bound the tool applies.</p>
</article></main>
<footer><p>FOOTER SENTINEL: this colophon must not reach the render.</p></footer></body></html>`;

/** A sign-in shell: Readability returns a stub the quality gate refuses, so
 *  the read falls back to the raw body with its note. */
const NAV_ONLY_HTML = `<!doctype html><html><head><title>Sign in</title></head><body>
<nav><a href="/login">Sign in</a><a href="/help">Help</a></nav>
<main><h1>Sign in</h1><form><label>Email <input name="email"></label><button>Continue</button></form></main>
</body></html>`;

/** A page that announces its own Markdown alternate in the `Link` header. */
const ANNOUNCED_PAGE_HTML = `<!doctype html><html><head><title>Announced</title></head><body>
<main><article><h1>Announced alternate</h1><p>This markup exists only to carry the announcement: the read is expected to take the Markdown URL the response names instead of converting it.</p></article></main>
</body></html>`;

/** What the announced Markdown alternate serves: over the quality gate's
 *  length, on long lines, and free of markup. */
const ALTERNATE_BODY = `# Announced alternate

The publisher served this Markdown at the URL its page announced, so the read took the higher-fidelity body instead of converting markup.
`;

/** What the page's Markdown suffix sibling serves, long enough to pass the
 *  same gate the render does. */
const SUFFIX_BODY = `# Suffix sibling

The publisher keeps this Markdown beside the page, so the read takes the sibling file instead of converting the page's own markup.
`;

/** An `llms.txt` index: short link lines, which only the walk's
 *  length-and-shape rule accepts. */
const LLMS_TXT_BODY = `# Fixture Docs

- [Adapter pipelines](https://fixture.test/adapter-pipelines)
- [Negotiation](https://fixture.test/negotiation)
- [Local render](https://fixture.test/render)
`;

/** One request the fixture server observed, in arrival order. */
type FixtureRequest = {
  readonly method: string;
  readonly path: string;
  readonly accept: string | undefined;
  readonly userAgent: string | undefined;
};

type WebFixture = {
  readonly origin: string;
  /** Every request observed so far; each case clears it before its own read. */
  readonly requests: Array<FixtureRequest>;
  close(): Promise<void>;
};

type LoopbackAddress = '127.0.0.1' | '127.0.0.2';

type AddressFixtureRequest = {
  readonly address: LoopbackAddress;
  readonly path: string;
  readonly socket: Socket;
};

type AddressFixture = {
  readonly port: number;
  readonly requests: Array<AddressFixtureRequest>;
  readonly sockets: Record<LoopbackAddress, Array<Socket>>;
  close(): Promise<void>;
};

type AddressFixtureRoute = (
  address: LoopbackAddress,
  request: IncomingMessage,
  response: ServerResponse,
) => void;

/** A context with no executor identity at all: a web read needs none. */
function webContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: 'owner',
    chatId: 'chat',
    productUserAgent: USER_AGENT,
    tenantDb: {
      runAs: () => Promise.reject(new Error('Database unavailable')),
    },
    ...overrides,
  };
}

function send(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  sendWithHeaders(response, status, { 'content-type': contentType }, body);
}

function sendWithHeaders(
  response: ServerResponse,
  status: number,
  headers: OutgoingHttpHeaders,
  body = '',
): void {
  response.writeHead(status, headers);
  response.end(body);
}

/** Content negotiation on `Accept`: a publisher that serves Markdown for
 *  agents answers with it, and anything else falls back to HTML. */
function serveNegotiated(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  if ((request.headers.accept ?? '').includes('text/markdown')) {
    send(response, 200, 'text/markdown; charset=utf-8', MARKDOWN_BODY);
    return;
  }
  send(response, 200, 'text/html; charset=utf-8', NEGOTIATION_FALLBACK_HTML);
}

/** Streams past the cap with no declared length, stopping as soon as the
 *  client cancels — which a refused read does at the first chunk past it. */
function serveOversizedBody(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  const chunk = Buffer.alloc(OVERSIZED_CHUNK_BYTES, 'a');
  let written = 0;
  const writeNext = (): void => {
    while (written < OVERSIZED_BYTES && !response.destroyed) {
      written += chunk.byteLength;
      if (!response.write(chunk)) {
        response.once('drain', writeNext);
        return;
      }
    }
    response.end();
  };
  writeNext();
}

function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  switch (request.url ?? '') {
    case '/negotiated':
      serveNegotiated(request, response);
      return;
    case '/plain':
      send(response, 200, 'text/plain; charset=utf-8', PLAIN_BODY);
      return;
    case '/data.json':
      send(response, 200, 'application/json; charset=utf-8', JSON_BODY);
      return;
    case '/article':
      send(response, 200, 'text/html; charset=utf-8', ARTICLE_HTML);
      return;
    case '/nav-only':
      send(response, 200, 'text/html; charset=utf-8', NAV_ONLY_HTML);
      return;
    case '/announced':
      sendWithHeaders(
        response,
        200,
        {
          'content-type': 'text/html; charset=utf-8',
          // A relative target, resolved against this page's own URL.
          link: '</announced.md>; rel="alternate"; type="text/markdown"',
        },
        ANNOUNCED_PAGE_HTML,
      );
      return;
    case '/announced.md':
      send(response, 200, 'text/markdown; charset=utf-8', ALTERNATE_BODY);
      return;
    case '/suffix':
      send(response, 200, 'text/html; charset=utf-8', ARTICLE_HTML);
      return;
    case '/suffix.md':
      send(response, 200, 'text/markdown; charset=utf-8', SUFFIX_BODY);
      return;
    case '/guides/adapter-pipelines':
      // A gated page under two scopes: its failed render walks the page's own
      // scope first, then this one, where the index lives.
      send(response, 200, 'text/html; charset=utf-8', NAV_ONLY_HTML);
      return;
    case '/guides/llms.txt':
      send(response, 200, 'text/plain; charset=utf-8', LLMS_TXT_BODY);
      return;
    case '/oversized':
      serveOversizedBody(response);
      return;
    case '/document.pdf':
      sendWithHeaders(
        response,
        200,
        { 'content-type': 'application/pdf' },
        PDF_BODY,
      );
      return;
    case '/redirect':
      sendWithHeaders(response, 302, { location: REDIRECT_LOCATION }, 'Moved');
      return;
    case '/redirect-signed':
      sendWithHeaders(
        response,
        302,
        { location: `${REDIRECT_LOCATION}?token=secret#part` },
        'Moved',
      );
      return;
    case REDIRECT_LOCATION:
      send(response, 200, 'text/markdown; charset=utf-8', MOVED_BODY);
      return;
    case '/rate-limited':
      sendWithHeaders(
        response,
        429,
        { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '120' },
        RATE_LIMIT_BODY,
      );
      return;
    default:
      send(response, 404, 'text/plain; charset=utf-8', NOT_FOUND_BODY);
  }
}

async function listenOnLoopbackPort(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    // The error listener stays: it settles this promise, and after that it
    // keeps a later server-level error from crashing the run.
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const address = server.address();
  if (address === null || isString(address)) {
    throw new TypeError('The web fixture server did not start listening.');
  }
  return address.port;
}

/**
 * A local HTTP server the real tool reaches over a real socket, so the request
 * count a case asserts is the server's own observation rather than a double's.
 * The `policy` layer extends this same server with the alternate, suffix,
 * `llms.txt`, and redirect cases.
 */
async function startWebFixture(): Promise<WebFixture> {
  const requests: Array<FixtureRequest> = [];
  const server = createServer((request, response) => {
    requests.push({
      method: request.method ?? '',
      path: request.url ?? '',
      accept: request.headers.accept,
      userAgent: request.headers['user-agent'],
    });
    // A refused body is cancelled mid-stream, so the fixture must survive a
    // write to a socket the client has already torn down.
    request.on('error', () => undefined);
    response.on('error', () => undefined);
    routeRequest(request, response);
  });
  server.on('clientError', (_error, socket) => {
    socket.destroy();
  });
  const port = await listenOnLoopbackPort(server);

  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

/** Two fixtures on the same port make the selected destination observable at
 *  the server's connection boundary, rather than through a fetch double. */
async function startAddressFixture(
  route: AddressFixtureRoute,
): Promise<AddressFixture> {
  const requests: Array<AddressFixtureRequest> = [];
  const sockets: Record<LoopbackAddress, Array<Socket>> = {
    '127.0.0.1': [],
    '127.0.0.2': [],
  };
  const makeServer = (address: LoopbackAddress): Server => {
    const server = createServer((request, response) => {
      requests.push({
        address,
        path: request.url ?? '',
        socket: request.socket,
      });
      request.on('error', () => undefined);
      response.on('error', () => undefined);
      route(address, request, response);
    });
    server.on('connection', (socket) => sockets[address].push(socket));
    server.on('clientError', (_error, socket) => socket.destroy());
    return server;
  };
  const first = makeServer('127.0.0.1');
  const second = makeServer('127.0.0.2');

  const port = await listenOnAddress(first, '127.0.0.1', 0);
  await listenOnAddress(second, '127.0.0.2', port);

  return {
    port,
    requests,
    sockets,
    close: async () => {
      first.closeAllConnections();
      second.closeAllConnections();
      await Promise.all(
        [first, second].map(
          (server) =>
            new Promise<void>((resolve, reject) => {
              server.close((error) => {
                if (error) reject(error);
                else resolve();
              });
            }),
        ),
      );
    },
  };
}

async function listenOnAddress(
  server: Server,
  address: LoopbackAddress,
  port: number,
): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, address, () => resolve());
  });
  const listeningAddress = server.address();
  if (listeningAddress === null || isString(listeningAddress)) {
    throw new TypeError('The address fixture server did not start listening.');
  }
  return listeningAddress.port;
}

/** The rendered text of a read the case expects to succeed: a missing field
 *  means the read never reached the render, so this fails loudly. */
function contentOf(result: ToolResult): string {
  if (result.status !== 'success') {
    throw new TypeError('The read failed instead of rendering a document.');
  }
  const { content } = result;
  if (!isString(content)) {
    throw new TypeError('The read returned no rendered content.');
  }
  return content;
}

/** A refused read, whose shape is `{ status, type, message }` plus, for the
 *  hop refusal alone, the locator's origin and path as `rejectedUrl`: neither
 *  the response body nor a success field such as `method` or `finalUrl` rides
 *  along with a failure. */
function errorOf(result: ToolResult): {
  readonly type: string;
  readonly message: string;
} {
  if (result.status !== 'error') {
    throw new TypeError('The read succeeded where the case expects a refusal.');
  }
  expect(Object.keys(result).sort()).toEqual(
    result.type === 'permission_denied'
      ? ['message', 'rejectedUrl', 'status', 'type']
      : ['message', 'status', 'type'],
  );
  return result;
}

function addressRejectPolicy(regex: string): CompiledPolicy {
  return compileToolPermissionMap(
    {
      read: {
        allow: true,
        reject: [{ field: 'path', regex }],
      },
    },
    'address-test-policy',
  );
}
function readWithAddressPolicy(
  execute: WebReadExecutor,
  permissionPolicy: CompiledPolicy,
  path: string,
): Promise<ToolResult> {
  return execute(webContext({ permissionPolicy }), {
    operation: 'read',
    input: { path },
  });
}

function expectAddressRefused(result: ToolResult): void {
  expect(result).toMatchObject({
    status: 'error',
    type: 'permission_denied',
    message: REJECTED_ADDRESS_MESSAGE,
  });
}

function markdownRedirectRoute(
  redirectPath: string,
  location: string,
): AddressFixtureRoute {
  return (_address, request, response) => {
    if (request.url === redirectPath) {
      sendWithHeaders(response, 302, { location }, 'Moved');
      return;
    }
    send(response, 200, 'text/markdown; charset=utf-8', ADDRESS_BODY);
  };
}

function announcedAlternatePageRoute(port: number): AddressFixtureRoute {
  return (_address, request, response) => {
    if (request.url === '/page') {
      sendWithHeaders(
        response,
        200,
        {
          'content-type': 'text/html; charset=utf-8',
          link: `<http://alternate.test:${port}/private>; rel="alternate"; type="text/markdown"`,
        },
        ANNOUNCED_PAGE_HTML,
      );
      return;
    }
    if (request.url === '/page.md') {
      send(response, 404, 'text/plain; charset=utf-8', NOT_FOUND_BODY);
      return;
    }
    send(response, 200, 'text/markdown; charset=utf-8', ADDRESS_BODY);
  };
}

describe('web read over a fixture server', () => {
  let fixture: WebFixture;

  beforeAll(async () => {
    fixture = await startWebFixture();
  });

  afterAll(async () => {
    // Truthiness, not a comparison: the variable is typed as the started
    // fixture, exactly as the other integration suites check their handles.
    if (fixture) await fixture.close();
  });

  beforeEach(() => {
    fixture.requests.length = 0;
  });

  /** The real tool, over the real `globalThis.fetch`, under a policy that
   *  admits every derived locator unless a case binds its own. */
  const read = (
    path: string,
    policy: CompiledPolicy = ADMIT_EVERY_LOCATOR,
  ): Promise<ToolResult> =>
    Promise.resolve(
      nativeReadTool.execute(webContext({ permissionPolicy: policy }), {
        path,
      }),
    );

  const urlOf = (path: string): string => `${fixture.origin}${path}`;

  it('negotiates a publisher Markdown body with one request', async () => {
    const result = await read(urlOf('/negotiated'));

    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      representation: 'text',
      method: 'negotiated',
    });
    expect(result).toHaveProperty('finalUrl', urlOf('/negotiated'));
    expect(result).toHaveProperty(
      'content',
      '1: # Adapter pipelines\n2: \n3: Served by the publisher for agents.\n',
    );
    expect(result).not.toHaveProperty('notes');
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0].method).toBe('GET');
    expect(fixture.requests[0].path).toBe('/negotiated');
    expect(fixture.requests[0].accept).toContain('text/markdown');
    expect(fixture.requests[0].userAgent).toBe(USER_AGENT);
  });

  it('takes a publisher plain-text body as served', async () => {
    const result = await read(urlOf('/plain'));

    expect(result).toMatchObject({
      status: 'success',
      representation: 'text',
      method: 'negotiated',
    });
    expect(result).toHaveProperty('finalUrl', urlOf('/plain'));
    expect(result).toHaveProperty(
      'content',
      '1: Adapter pipelines\n2: \n3: Served as plain text for agents.\n',
    );
    expect(result).not.toHaveProperty('notes');
    expect(fixture.requests).toHaveLength(1);
  });

  it('returns a JSON body as text', async () => {
    const result = await read(urlOf('/data.json'));

    expect(result).toMatchObject({
      status: 'success',
      representation: 'text',
      method: 'text',
    });
    expect(result).toHaveProperty('finalUrl', urlOf('/data.json'));
    expect(result).toHaveProperty(
      'content',
      '1: {"adapter":"markdown","requests":1}',
    );
    expect(result).not.toHaveProperty('notes');
    expect(fixture.requests).toHaveLength(1);
  });

  it('renders the article without its chrome', async () => {
    const result = await read(urlOf('/article'));

    expect(result).toMatchObject({
      status: 'success',
      representation: 'text',
      method: 'readability',
    });
    expect(result).toHaveProperty('finalUrl', urlOf('/article'));
    expect(result).not.toHaveProperty('notes');

    const content = contentOf(result);
    // Numbered line by line, as a local read is, so the markers are stripped
    // before the Markdown the render produced is read back.
    const markdown = content.replaceAll(/^\d+: ?/gmu, '');
    expect(markdown).toContain('## Negotiation');
    expect(markdown).toContain('| Adapter | Body type | Requests |');
    expect(markdown).toContain('| --- | --- | --- |');
    expect(markdown).toContain('| Negotiation | text/markdown | 1 |');
    expect(markdown).toContain(
      '```\nconst article = new Readability(document).parse();\n```',
    );
    // A relative link, resolved against the response's own URL.
    expect(markdown).toContain(
      `[read reference](${fixture.origin}/reference/read)`,
    );
    expect(markdown).not.toContain('HEADER SENTINEL');
    expect(markdown).not.toContain('NAV SENTINEL');
    expect(markdown).not.toContain('FOOTER SENTINEL');
    // The publisher serves no Markdown suffix, so its 404 disqualifies the
    // candidate and the local render decides.
    expect(fixture.requests.map((request) => request.path)).toEqual([
      '/article',
      '/article.md',
    ]);
  });

  it('falls back to the raw body with a note', async () => {
    const result = await read(urlOf('/nav-only'));

    expect(result).toMatchObject({
      status: 'success',
      representation: 'text',
      method: 'raw',
    });
    expect(result).toHaveProperty('finalUrl', urlOf('/nav-only'));
    expect(result).toHaveProperty('notes', [
      expect.stringMatching(/could not be converted/i),
    ]);
    expect(contentOf(result)).toContain('Sign in');
    // The render fails the gate, so the read probes the suffix and then walks
    // `llms.txt` from the page's own scope to the root before the raw body is
    // the last resort.
    expect(fixture.requests.map((request) => request.path)).toEqual([
      '/nav-only',
      '/nav-only.md',
      '/nav-only/llms.txt',
      '/llms.txt',
    ]);
  });

  it('fetches the Markdown alternate a page announces', async () => {
    const result = await read(urlOf('/announced'));

    expect(result).toMatchObject({ status: 'success', method: 'alternate' });
    // The probe's own response, not the page's URL, is where the content
    // came from.
    expect(result).toHaveProperty('finalUrl', urlOf('/announced.md'));
    expect(contentOf(result)).toContain('# Announced alternate');
    expect(contentOf(result)).toContain('took the higher-fidelity body');
    expect(result).not.toHaveProperty('notes');
    expect(fixture.requests.map((request) => request.path)).toEqual([
      '/announced',
      '/announced.md',
    ]);
    // A probe negotiates exactly as the first request did.
    expect(fixture.requests[1].accept).toBe(fixture.requests[0].accept);
    expect(fixture.requests[1].userAgent).toBe(USER_AGENT);
  });

  it('fetches the page’s Markdown suffix sibling', async () => {
    const result = await read(urlOf('/suffix'));

    expect(result).toMatchObject({ status: 'success', method: 'md-suffix' });
    expect(result).toHaveProperty('finalUrl', urlOf('/suffix.md'));
    expect(contentOf(result)).toContain('# Suffix sibling');
    expect(contentOf(result)).toContain('takes the sibling file');
    expect(fixture.requests.map((request) => request.path)).toEqual([
      '/suffix',
      '/suffix.md',
    ]);
  });

  it('walks llms.txt from the page scope outward after a gated render', async () => {
    const result = await read(urlOf('/guides/adapter-pipelines'));

    expect(result).toMatchObject({ status: 'success', method: 'llms-txt' });
    // The winning index is the content's source, so it is the reported URL.
    expect(result).toHaveProperty('finalUrl', urlOf('/guides/llms.txt'));
    expect(contentOf(result)).toContain('Fixture Docs');
    // The suffix 404s, the page's own scope has no index, and the enclosing
    // scope's index wins before the walk reaches the site root.
    expect(fixture.requests.map((request) => request.path)).toEqual([
      '/guides/adapter-pipelines',
      '/guides/adapter-pipelines.md',
      '/guides/adapter-pipelines/llms.txt',
      '/guides/llms.txt',
    ]);
  });

  it('renders the page instead of fetching a probe the read group refuses', async () => {
    // One case per kind the pipeline derives: the announced alternate, the
    // `.md` sibling, and the `llms.txt` walk. Each page is admitted and every
    // locator derived from it is refused, so a probe the pipeline checked is
    // skipped without a request and the local render decides.
    const announced = await read(urlOf('/announced'), ADMIT_PAGE_ONLY);
    expect(announced).toMatchObject({
      status: 'success',
      method: 'readability',
    });
    expect(contentOf(announced)).toContain('carry the announcement');

    const suffix = await read(urlOf('/suffix'), ADMIT_PAGE_ONLY);
    expect(suffix).toMatchObject({ status: 'success', method: 'readability' });
    expect(contentOf(suffix)).toContain('## Negotiation');

    // This page's render fails the gate, so the walk would decide the read if
    // a candidate were admitted: refused, the render's own raw fallback is
    // what remains.
    const walked = await read(
      urlOf('/guides/adapter-pipelines'),
      ADMIT_PAGE_ONLY,
    );
    expect(walked).toMatchObject({ status: 'success', method: 'raw' });
    expect(contentOf(walked)).toContain('Sign in');

    // The decisive record: not one probe URL reached the server, so an
    // admission check the pipeline skipped for any kind but `alternate` — or
    // an executor that handed the pipeline an admitting check of its own —
    // would show up here.
    expect(fixture.requests.map((request) => request.path)).toEqual([
      '/announced',
      '/suffix',
      '/guides/adapter-pipelines',
    ]);
  });

  it('refuses a streamed body past the 5 MiB cap', async () => {
    const result = await read(urlOf('/oversized'));
    const error = errorOf(result);

    expect(error.type).toBe('body_too_large');
    expect(error.message).toContain('5 MiB');
    expect(fixture.requests).toHaveLength(1);
  });

  it('refuses a PDF body with its media type named', async () => {
    const result = await read(urlOf('/document.pdf'));
    const error = errorOf(result);

    expect(error.type).toBe('unsupported_content_type');
    expect(error.message).toContain('application/pdf');
    expect(JSON.stringify(result)).not.toContain('%PDF');
    expect(fixture.requests).toHaveLength(1);
  });

  it('follows a 302 the read group admits and reports the final URL', async () => {
    const result = await read(urlOf('/redirect'));

    expect(result).toMatchObject({ status: 'success', method: 'negotiated' });
    expect(result).toHaveProperty('finalUrl', urlOf('/moved-target'));
    expect(result).toHaveProperty(
      'content',
      '1: # Moved\n2: \n3: Served at the redirect target.\n',
    );
    expect(fixture.requests.map((request) => request.path)).toEqual([
      '/redirect',
      '/moved-target',
    ]);
    // Every hop identifies llame and negotiates exactly as the first request
    // did, and the result enumerates no hop chain.
    expect(fixture.requests[1].accept).toBe(fixture.requests[0].accept);
    expect(fixture.requests[1].userAgent).toBe(USER_AGENT);
    expect(result).not.toHaveProperty('hops');
  });

  it('ends the call at a hop the read group refuses, without fetching it', async () => {
    const result = await read(urlOf('/redirect'), REFUSE_HOP_TARGET);
    const error = errorOf(result);

    expect(error.type).toBe('permission_denied');
    expect(result).toHaveProperty('rejectedUrl', urlOf('/moved-target'));
    // The message is the fixed template: it names no locator, rule, or clause.
    expect(error.message).not.toContain('moved-target');
    expect(error.message).not.toContain('127.0.0.1');
    expect(fixture.requests.map((request) => request.path)).toEqual([
      '/redirect',
    ]);
  });

  it('reports a refused hop’s origin and path without its query or fragment', async () => {
    const result = await read(urlOf('/redirect-signed'), REFUSE_HOP_TARGET);

    expect(result).toHaveProperty('rejectedUrl', urlOf('/moved-target'));
    // A signed query in a `Location` never reaches the model.
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(fixture.requests.map((request) => request.path)).toEqual([
      '/redirect-signed',
    ]);
  });

  it('fails a 404 without its body', async () => {
    const result = await read(urlOf('/missing'));
    const error = errorOf(result);

    expect(error.type).toBe('http_status');
    expect(error.message).toContain('HTTP 404');
    expect(JSON.stringify(result)).not.toContain(NOT_FOUND_BODY);
    expect(fixture.requests).toHaveLength(1);
  });

  it('fails a 429 and reports the retry delay', async () => {
    const result = await read(urlOf('/rate-limited'));
    const error = errorOf(result);

    expect(error.type).toBe('http_status');
    expect(error.message).toMatch(/429.*120/u);
    expect(JSON.stringify(result)).not.toContain(RATE_LIMIT_BODY);
    expect(fixture.requests).toHaveLength(1);
  });

  it('applies a line selector to the rendered text', async () => {
    const full = await read(urlOf('/article'));
    const selected = await read(`${urlOf('/article')}:5-10`);

    expect(selected).toMatchObject({
      status: 'success',
      representation: 'text',
      method: 'readability',
      requestedRange: { startLine: 5, endLine: 10 },
      shownRange: { startLine: 4, endLine: 11 },
      truncated: false,
    });
    // The locator is reported with its selector stripped, as a local read
    // reports the path.
    expect(selected).toHaveProperty('path', urlOf('/article'));
    expect(selected).toHaveProperty('finalUrl', urlOf('/article'));
    expect(selected).not.toHaveProperty('notes');

    // The window is the rendered text's lines 5-10 with one context line each
    // side, so it can only match a selector applied to the render.
    const renderedLines = contentOf(full).split('\n');
    expect(contentOf(selected)).toBe(
      `${renderedLines.slice(3, 11).join('\n')}\n`,
    );
    // No cache: the second read issues its own request and its own suffix
    // probe, both of which answer exactly as they did the first time.
    expect(fixture.requests.map((request) => request.path)).toEqual([
      '/article',
      '/article.md',
      '/article',
      '/article.md',
    ]);
  });

  it('returns the body untouched for :raw', async () => {
    const result = await read(`${urlOf('/article')}:raw`);

    expect(result).toMatchObject({
      status: 'success',
      representation: 'raw',
      method: 'raw',
    });
    expect(result).toHaveProperty('finalUrl', urlOf('/article'));
    expect(result).toHaveProperty('content', ARTICLE_HTML);
    expect(result).not.toHaveProperty('notes');
    expect(fixture.requests).toHaveLength(1);
  });

  it('reads a port, a line, and an anchor from one real origin', async () => {
    // The fixture listens on an explicit port, so this exercises the two
    // readings of `:N` against a real socket: the one before the path
    // separator is the port the request connects to, the one after the last
    // separator is the line the result shows.
    const line = await read(`${urlOf('/plain')}:2`);

    expect(line).toMatchObject({
      status: 'success',
      requestedRange: { startLine: 2, endLine: 2 },
      shownRange: { startLine: 1, endLine: 3 },
    });
    expect(line).toHaveProperty('finalUrl', urlOf('/plain'));

    // The pathless origin carries no selector at all: its `:<port>` is the
    // port, and the request goes to the serialized root — which this fixture
    // does not serve, so the read fails on the origin's own answer rather
    // than on the locator.
    const root = await read(fixture.origin);
    expect(root).toMatchObject({ status: 'error', type: 'http_status' });

    // An anchor is cut before the request, so the page is read and the origin
    // never sees the fragment.
    const anchored = await read(`${urlOf('/plain')}#section`);
    expect(anchored).toMatchObject({ status: 'success' });
    expect(anchored).toHaveProperty('finalUrl', urlOf('/plain'));
    expect(contentOf(anchored)).toBe(contentOf(await read(urlOf('/plain'))));
    expect(fixture.requests.map((request) => request.path)).toEqual([
      '/plain',
      '/',
      '/plain',
      '/plain',
    ]);
  });
});

describe('web read address admission over loopback fixtures', () => {
  let fixture: AddressFixture;
  let route: AddressFixtureRoute = (_address, _request, response) =>
    send(response, 200, 'text/markdown; charset=utf-8', ADDRESS_BODY);

  beforeAll(async () => {
    fixture = await startAddressFixture((address, request, response) =>
      route(address, request, response),
    );
  });

  afterAll(async () => {
    if (fixture) await fixture.close();
  });

  beforeEach(() => {
    fixture.requests.length = 0;
    fixture.sockets['127.0.0.1'].length = 0;
    fixture.sockets['127.0.0.2'].length = 0;
    route = (_address, _request, response) =>
      send(response, 200, 'text/markdown; charset=utf-8', ADDRESS_BODY);
  });

  it('A refused address is skipped', async () => {
    const resolve: ResolveHost = () =>
      Promise.resolve<ReadonlyArray<ResolvedAddress>>([
        { address: '127.0.0.2', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]);
    const execute = createWebReadExecutor({ ...realWebReadDeps, resolve });
    const result = await execute(
      webContext({
        permissionPolicy: addressRejectPolicy(
          String.raw`^https?://127\.0\.0\.2[:/]`,
        ),
      }),
      {
        operation: 'read',
        input: { path: `http://dual.test:${fixture.port}/page` },
      },
    );

    expect(result).toMatchObject({ status: 'success' });
    expect(contentOf(result)).toContain('Served from an admitted address.');
    expect(fixture.sockets['127.0.0.1'].length).toBeGreaterThan(0);
    expect(fixture.sockets['127.0.0.2']).toHaveLength(0);
  });

  it('The checked answer is the one dialed', async () => {
    const resolvedHosts: Array<string> = [];
    const resolve: ResolveHost = (hostname) => {
      resolvedHosts.push(hostname);
      return Promise.resolve<ReadonlyArray<ResolvedAddress>>([
        {
          address: resolvedHosts.length === 1 ? '127.0.0.1' : '127.0.0.2',
          family: 4,
        },
      ]);
    };
    route = (_address, request, response) => {
      if (request.url === '/start') {
        sendWithHeaders(response, 302, { location: '/next' }, 'Moved');
        return;
      }
      send(response, 200, 'text/markdown; charset=utf-8', ADDRESS_BODY);
    };
    const execute = createWebReadExecutor({ ...realWebReadDeps, resolve });
    const result = await execute(
      webContext({
        permissionPolicy: addressRejectPolicy(
          String.raw`^http://127\.0\.0\.2[:/]`,
        ),
      }),
      {
        operation: 'read',
        input: { path: `http://swap.test:${fixture.port}/start` },
      },
    );

    expect(result).toMatchObject({
      status: 'success',
      finalUrl: `http://swap.test:${fixture.port}/next`,
    });
    expect(resolvedHosts).toEqual(['swap.test']);
    expect(
      fixture.requests.map(({ address, path }) => ({ address, path })),
    ).toEqual([
      { address: '127.0.0.1', path: '/start' },
      { address: '127.0.0.1', path: '/next' },
    ]);
    expect(fixture.sockets['127.0.0.2']).toHaveLength(0);
  });

  it('A connection is not reused across paths', async () => {
    const resolvedHosts: Array<string> = [];
    const resolve: ResolveHost = (hostname) => {
      resolvedHosts.push(hostname);
      return Promise.resolve<ReadonlyArray<ResolvedAddress>>([
        { address: '127.0.0.1', family: 4 },
        { address: '127.0.0.2', family: 4 },
      ]);
    };
    route = (_address, request, response) => {
      if (request.url === '/page') {
        send(response, 200, 'text/html; charset=utf-8', ARTICLE_HTML);
        return;
      }
      if (request.url === '/page.md') {
        send(response, 404, 'text/plain; charset=utf-8', NOT_FOUND_BODY);
        return;
      }
      send(response, 200, 'text/markdown; charset=utf-8', ADDRESS_BODY);
    };
    const execute = createWebReadExecutor({ ...realWebReadDeps, resolve });
    const result = await execute(
      webContext({
        permissionPolicy: addressRejectPolicy(
          String.raw`^http://127\.0\.0\.1:${fixture.port}/page\.md`,
        ),
      }),
      {
        operation: 'read',
        input: { path: `http://paths.test:${fixture.port}/page` },
      },
    );

    expect(result).toMatchObject({
      status: 'success',
      method: 'readability',
      finalUrl: `http://paths.test:${fixture.port}/page`,
    });
    expect(contentOf(result)).toContain('## Negotiation');
    expect(resolvedHosts).toEqual(['paths.test']);
    expect(
      fixture.requests.map(({ address, path }) => ({ address, path })),
    ).toEqual([
      { address: '127.0.0.1', path: '/page' },
      { address: '127.0.0.2', path: '/page.md' },
    ]);
    expect(fixture.requests[1].socket).not.toBe(fixture.requests[0].socket);
  });

  it('A hop is judged by the address it resolves to', async () => {
    const resolvedHosts: Array<string> = [];
    const resolve: ResolveHost = (hostname) => {
      resolvedHosts.push(hostname);
      if (hostname === 'pub.test') {
        return Promise.resolve<ReadonlyArray<ResolvedAddress>>([
          { address: '127.0.0.1', family: 4 },
        ]);
      }
      if (hostname === 'files.test') {
        return Promise.resolve<ReadonlyArray<ResolvedAddress>>([
          { address: '127.0.0.2', family: 4 },
        ]);
      }
      return Promise.reject(
        new Error('The address fixture received an unexpected hostname.'),
      );
    };
    route = (_address, request, response) => {
      if (request.url === '/start') {
        sendWithHeaders(
          response,
          302,
          {
            location: `http://files.test:${fixture.port}/private`,
          },
          'Moved',
        );
        return;
      }
      send(response, 200, 'text/markdown; charset=utf-8', ADDRESS_BODY);
    };
    const execute = createWebReadExecutor({ ...realWebReadDeps, resolve });
    const result = await execute(
      webContext({
        permissionPolicy: addressRejectPolicy(
          String.raw`^http://127\.0\.0\.2:${fixture.port}/private`,
        ),
      }),
      {
        operation: 'read',
        input: { path: `http://pub.test:${fixture.port}/start` },
      },
    );

    expect(result).toStrictEqual({
      status: 'error',
      type: 'permission_denied',
      message: REJECTED_ADDRESS_MESSAGE,
      rejectedUrl: `http://files.test:${fixture.port}/private`,
    });
    expect(JSON.stringify(result)).not.toContain('127.0.0.2');
    expect(resolvedHosts).toEqual(['pub.test', 'files.test']);
    expect(
      fixture.requests.map(({ address, path }) => ({ address, path })),
    ).toEqual([{ address: '127.0.0.1', path: '/start' }]);
    expect(fixture.sockets['127.0.0.2']).toHaveLength(0);
  });

  it('Cleartext stays open to internal addresses only', async () => {
    const loopUrl = `http://loop.test:${fixture.port}/`;
    const publicUrl = `http://public.test:${fixture.port}/`;
    const fetchUrls: Array<string> = [];
    const realFetch = realWebReadDeps.fetch;
    if (realFetch === undefined) {
      throw new TypeError('The real web fetch dependency is unavailable.');
    }
    const fetch: typeof realFetch = (input, init) => {
      let url: string;
      if (input instanceof URL) {
        url = input.href;
      } else if (input instanceof Request) {
        url = input.url;
      } else if (isString(input)) {
        url = input;
      } else {
        throw new TypeError('The web fetch input is invalid.');
      }
      fetchUrls.push(url);
      if (url === publicUrl) {
        return Promise.reject(
          new Error('A refused public address reached the transport.'),
        );
      }
      return realFetch(input, init);
    };
    const resolve: ResolveHost = (hostname) => {
      if (hostname === 'loop.test') {
        return Promise.resolve<ReadonlyArray<ResolvedAddress>>([
          { address: '127.0.0.1', family: 4 },
        ]);
      }
      if (hostname === 'public.test') {
        return Promise.resolve<ReadonlyArray<ResolvedAddress>>([
          { address: '93.184.216.34', family: 4 },
        ]);
      }
      return Promise.reject(
        new Error('The address fixture received an unexpected hostname.'),
      );
    };
    const execute = createWebReadExecutor({
      ...realWebReadDeps,
      fetch,
      resolve,
    });
    const internal = await execute(
      webContext({ permissionPolicy: PORTABLE_READ_POLICY }),
      { operation: 'read', input: { path: loopUrl } },
    );
    const publicResult = await execute(
      webContext({ permissionPolicy: PORTABLE_READ_POLICY }),
      { operation: 'read', input: { path: publicUrl } },
    );

    expect(internal).toMatchObject({ status: 'success' });
    expect(contentOf(internal)).toContain('Served from an admitted address.');
    expect(publicResult).toMatchObject({
      status: 'error',
      type: 'permission_denied',
      message: REJECTED_ADDRESS_MESSAGE,
    });
    expect(publicResult).not.toHaveProperty('rejectedUrl');
    expect(JSON.stringify(publicResult)).not.toContain('93.184.216.34');
    expect(fetchUrls).toEqual([loopUrl]);
    expect(fixture.sockets['127.0.0.1'].length).toBeGreaterThan(0);
    expect(fixture.sockets['127.0.0.2']).toHaveLength(0);
  });

  it('An address reject holds for every name', async () => {
    const resolve: ResolveHost = (hostname) =>
      Promise.resolve<ReadonlyArray<ResolvedAddress>>([
        {
          address: hostname === 'admitted.test' ? '127.0.0.1' : '127.0.0.2',
          family: 4,
        },
      ]);
    route = markdownRedirectRoute(
      '/redirect',
      `http://export.test:${fixture.port}/private`,
    );
    const policy = addressRejectPolicy(
      String.raw`^https?://127\.0\.0\.2:${fixture.port}/private`,
    );
    const execute = createWebReadExecutor({ ...realWebReadDeps, resolve });
    const denied = await Promise.all(
      [
        `http://export.test:${fixture.port}/private`,
        `http://x.attacker.test:${fixture.port}/private`,
        `http://admitted.test:${fixture.port}/redirect`,
      ].map((path) => readWithAddressPolicy(execute, policy, path)),
    );
    for (const result of denied) expectAddressRefused(result);
    expect(fixture.sockets['127.0.0.2']).toHaveLength(0);
    const data = await readWithAddressPolicy(
      execute,
      policy,
      `http://export.test:${fixture.port}/data`,
    );

    expect(contentOf(data)).toContain('Served from an admitted address.');
    expect(
      fixture.requests.map(({ address, path }) => ({ address, path })),
    ).toEqual([
      { address: '127.0.0.1', path: '/redirect' },
      { address: '127.0.0.2', path: '/data' },
    ]);
    expect(fixture.sockets['127.0.0.2']).toHaveLength(1);
  });

  it('A selector is not part of the address locator', async () => {
    const resolve: ResolveHost = () =>
      Promise.resolve<ReadonlyArray<ResolvedAddress>>([
        { address: '127.0.0.2', family: 4 },
      ]);
    const policy = addressRejectPolicy(
      String.raw`^https?://127\.0\.0\.2:${fixture.port}/private$`,
    );
    const execute = createWebReadExecutor({ ...realWebReadDeps, resolve });
    const result = await readWithAddressPolicy(
      execute,
      policy,
      `http://export.test:${fixture.port}/private:raw`,
    );

    expectAddressRefused(result);
    expect(fixture.requests).toHaveLength(0);
    expect(fixture.sockets['127.0.0.2']).toHaveLength(0);
  });

  it('A hop to a private address is admitted by its text', async () => {
    const resolve: ResolveHost = () =>
      Promise.resolve<ReadonlyArray<ResolvedAddress>>([
        { address: '127.0.0.1', family: 4 },
      ]);
    route = markdownRedirectRoute(
      '/redirect',
      `http://127.0.0.1:${fixture.port}/admin`,
    );
    const policy = addressRejectPolicy(
      String.raw`^https?://127\.0\.0\.2:${fixture.port}/private`,
    );
    const execute = createWebReadExecutor({ ...realWebReadDeps, resolve });
    const result = await readWithAddressPolicy(
      execute,
      policy,
      `http://admitted.test:${fixture.port}/redirect`,
    );

    expect(result).toMatchObject({
      status: 'success',
      finalUrl: `http://127.0.0.1:${fixture.port}/admin`,
    });
    expect(contentOf(result)).toContain('Served from an admitted address.');
    expect(
      fixture.requests.map(({ address, path }) => ({ address, path })),
    ).toEqual([
      { address: '127.0.0.1', path: '/redirect' },
      { address: '127.0.0.1', path: '/admin' },
    ]);
  });

  it('A resolved IPv4-mapped answer is judged as IPv4', async () => {
    const resolve: ResolveHost = () =>
      Promise.resolve<ReadonlyArray<ResolvedAddress>>([
        { address: '::ffff:127.0.0.2', family: 6 },
      ]);
    const policy = addressRejectPolicy(
      String.raw`^https?://127\.0\.0\.2:${fixture.port}/private`,
    );
    const execute = createWebReadExecutor({ ...realWebReadDeps, resolve });
    const result = await readWithAddressPolicy(
      execute,
      policy,
      `http://mapped.test:${fixture.port}/private`,
    );

    expectAddressRefused(result);
    expect(fixture.requests).toHaveLength(0);
    expect(fixture.sockets['127.0.0.2']).toHaveLength(0);
  });

  it('No resolved address reaches the model', async () => {
    const resolvedHosts: Array<string> = [];
    const resolve: ResolveHost = (hostname) => {
      resolvedHosts.push(hostname);
      return Promise.resolve<ReadonlyArray<ResolvedAddress>>([
        {
          address: hostname === 'alternate.test' ? '127.0.0.2' : '127.0.0.1',
          family: 4,
        },
      ]);
    };
    route = announcedAlternatePageRoute(fixture.port);
    const policy = addressRejectPolicy(
      String.raw`^https?://127\.0\.0\.2:${fixture.port}/private`,
    );
    const execute = createWebReadExecutor({ ...realWebReadDeps, resolve });
    const result = await readWithAddressPolicy(
      execute,
      policy,
      `http://page.test:${fixture.port}/page`,
    );

    expect(result).toMatchObject({ status: 'success', method: 'readability' });
    expect(contentOf(result)).toContain('carry the announcement');
    expect(result).not.toHaveProperty('rejectedUrl');
    expect(JSON.stringify(result)).not.toContain(REJECTED_ADDRESS_MESSAGE);
    expect(resolvedHosts).toContain('alternate.test');
    expect(
      fixture.requests.map(({ address, path }) => ({ address, path })),
    ).toEqual([
      { address: '127.0.0.1', path: '/page' },
      { address: '127.0.0.1', path: '/page.md' },
    ]);
    expect(fixture.sockets['127.0.0.2']).toHaveLength(0);
  });
});
