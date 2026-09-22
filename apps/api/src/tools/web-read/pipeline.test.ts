import type { PermissionDecision } from '../permissions/types';
import type { DerivedLocatorKind } from './admission';
import type { WebFetchFailure, WebResponse } from './http-client';
import {
  passesQualityGate,
  renderWebContent,
  renderWebDocument,
} from './pipeline';
import type { WebPipelineDeps, WebRender } from './pipeline';

const BASE_URL = 'https://docs.example.test/guides/adapter-pipelines';

/** The spike fixture: header, nav, footer, prose, a table, a code block, links. */
const ARTICLE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Adapter pipelines for agent web reads - Example Docs</title>
<meta name="author" content="Dana Reyes"></head><body>
<header><a href="/">Example Docs</a><nav><a href="/guides">Guides</a><a href="/reference">Reference</a></nav></header>
<main><article><h1>Adapter pipelines for agent web reads</h1>
<p class="byline">By <a href="/authors/dana">Dana Reyes</a></p>
<p>A web read should prefer what a publisher already offers for agents before paying for a local conversion. This guide walks the ordered pipeline used by <a href="https://example.test/llame">llame</a>.</p>
<h2 id="negotiation">Negotiation</h2>
<p>The first request sends an <code>Accept</code> header that ranks <code>text/markdown</code> above <code>text/html</code>. See <a href="https://llmstxt.org/">llmstxt.org</a> for the format the walk expects to find.</p>
<blockquote><p>Serving markdown is both higher fidelity and cheaper than any HTML conversion the tool could perform locally.</p></blockquote>
<h2 id="render">Local render</h2>
<p>Only after the publisher-provided options are exhausted does the tool extract the main content locally, convert it with Turndown, and report which adapter produced it.</p>
<table><thead><tr><th>Step</th><th>Method</th></tr></thead><tbody><tr><td>4</td><td><code>readability</code></td></tr></tbody></table>
<pre><code>const article = new Readability(document).parse();</code></pre>
<p>The result reports the winning <code>method</code> so an operator can tell a negotiated body from a local render. Read the <a href="/reference/read">read reference</a> for every bound the tool applies.</p>
</article></main>
<footer><nav><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></nav></footer></body></html>`;

/** Readability finds no article here: the only text is image `alt`, so `parse()` returns null. */
const IMAGE_INDEX_HTML = `<!doctype html><html><head><title>Gallery</title></head><body>
<div id="index"><ul>
<li><a href="/guides/negotiation"><img alt="Negotiation: ranking publisher Markdown above HTML" src="/img/one.png"></a></li>
<li><a href="/guides/render"><img alt="Local render: Readability extraction and Turndown conversion" src="/img/two.png"></a></li>
<li><a href="/guides/raw"><img alt="Raw body: the last resort when every conversion fails" src="/img/three.png"></a></li>
</ul></div>
</body></html>`;

/** A short sign-in shell: Readability returns a stub article the quality gate refuses. */
const NAV_ONLY_HTML = `<!doctype html><html><head><title>Sign in</title></head><body>
<nav><a href="/login">Sign in</a><a href="/help">Help</a></nav>
<main><h1>Sign in</h1><form><label>Email <input name="email"></label><button>Continue</button></form></main>
</body></html>`;

/** A JavaScript interstitial, under the 1,024-character challenge bound. */
const CHALLENGE_HTML = `<!doctype html><html><head><title>Just a moment...</title></head><body>
<h1>Checking your browser</h1><p>Enable JavaScript and cookies to continue.</p>
</body></html>`;

/** An HTML document served with a `text/plain` content type. */
const PLAIN_SERVED_HTML = `<!doctype html><html><head><title>Plain served HTML</title></head><body><article>
<h2>Rendered from a text/plain response</h2>
<p>This body arrived with a text/plain content type even though it is an HTML document, so the pipeline follows the HTML path and renders its main content instead of returning the markup unchanged.</p>
</article></body></html>`;

/** An RSS feed served as `application/xml`: markup, but not an HTML document. */
const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Example Docs</title>
<item><title>Adapter pipelines for agent web reads</title><link>https://docs.example.test/guides/adapter-pipelines</link></item>
</channel></rss>`;

/** A plain XML body served as `text/xml`. */
const NOTE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<note><to>agent</to><from>editor</from><body>The local render path is HTML only.</body></note>`;

/** An XHTML document served as `application/xhtml+xml`. */
const XHTML_DOCUMENT = `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Adapter pipelines in XHTML</title></head><body><article>
<h2>An XHTML document renders locally</h2>
<p>The pipeline treats this media type as HTML, extracts the article with Readability, and converts the result to Markdown instead of returning the XHTML source.</p>
</article></body></html>`;

/** Prose long enough to clear the quality gate once it is converted. */
const FRAGMENT_PROSE =
  'The adapter pipeline keeps the body a publisher already served when it is Markdown, and otherwise extracts the main content locally with Readability before converting it to Markdown with Turndown.';

/** A body served as markup without an `html` root, which linkedom leaves bare. */
const FRAGMENT_HTML = `<div><h2>Fragment render</h2><p>${FRAGMENT_PROSE}</p></div>`;

/** The same fragment shape, with a stray `body` element inside its root. */
const STRAY_BODY_FRAGMENT_HTML = `<div><body><p>Sign in to continue.</p></body><p>${FRAGMENT_PROSE}</p></div>`;

/** An `html` document whose body holds no elements, so its only text is the head's. */
const BODY_LESS_HTML = `<!doctype html><html><head>
<title>Adapter pipelines for agent web reads: negotiation, local render, the quality gate, and every bound the tool applies | Example Docs</title>
</head><body></body></html>`;

/** The challenge phrase is split by a tag, so only the converted text carries it. */
const SPLIT_CHALLENGE_HTML = `<!doctype html><html><head><title>Console</title></head><body>
<p>The server wants to capt<span>cha</span> this request before serving the page.</p></body></html>`;

/** The challenge phrase sits in a comment, so only the served body carries it. */
const COMMENT_CHALLENGE_HTML = `<!doctype html><html><head><title>Console</title></head><body>
<!-- challenge marker: verify you are human --><p>Sign in to continue to the console.</p></body></html>`;

const response = (
  contentType: string,
  body: string,
  finalUrl = BASE_URL,
  link?: string,
): WebResponse => ({
  finalUrl,
  contentType,
  body,
  ...(link !== undefined && { link }),
});

/** A publisher Markdown body: over the gate's length, long lines, no markup. */
const PUBLISHER_MARKDOWN = `# Adapter pipelines for agent web reads

A publisher that serves Markdown for agents hands over the higher-fidelity body
without a local conversion, so the read costs one request and keeps the
publisher's own headings, links, and tables.
`;

/** An `llms.txt` index: short link lines the quality gate refuses, and exactly
 *  what the walk's length-and-shape rule exists to accept. */
const LLMS_TXT = `# Example Docs

- [Adapter pipelines](https://docs.example.test/guides/adapter-pipelines)
- [Negotiation](https://docs.example.test/guides/negotiation)
- [Local render](https://docs.example.test/guides/render)
`;

/** The answer every real probe expects: the candidate is simply not there. */
const NOT_FOUND: WebFetchFailure = {
  type: 'http_status',
  message: 'The server answered HTTP 404.',
};

/** The `read` group's own allow, shaped as the evaluator reports it. */
const ALLOWED: PermissionDecision = {
  policyId: 'test-policy',
  decision: 'allow',
  reason: 'matched_allow',
  reference: { groupId: 'read', list: 'allow', clauseIndex: null },
};

/** A `read` clause that admits no derived locator at all. */
const REFUSED: PermissionDecision = {
  policyId: 'test-policy',
  decision: 'reject',
  reason: 'no_allow',
  reference: null,
};

type PipelineHarness = {
  readonly deps: WebPipelineDeps;
  readonly requested: Array<string>;
  readonly admitted: Array<string>;
};

/**
 * A pipeline over an injected client and policy: `answers` names the URLs the
 * site serves (every other request answers 404), and `refused` names the
 * locators the `read` group rejects. Both calls are recorded, so a test can
 * tell a locator that was decided from one that was requested.
 */
function makePipeline(
  answers: Record<string, WebResponse | WebFetchFailure>,
  refused: ReadonlyArray<string> = [],
): PipelineHarness {
  const requested: Array<string> = [];
  const admitted: Array<string> = [];

  return {
    requested,
    admitted,
    deps: {
      fetch: (url) => {
        requested.push(url);

        return Promise.resolve(answers[url] ?? NOT_FOUND);
      },
      admit: (kind: DerivedLocatorKind, url: string) => {
        admitted.push(url);

        return refused.includes(url) ? REFUSED : ALLOWED;
      },
    },
  };
}

/** The pipeline's render, failing the test when the call failed instead. */
async function runPipeline(
  page: WebResponse,
  harness: PipelineHarness,
  options: { readonly raw: boolean } = { raw: false },
): Promise<WebRender> {
  const result = await renderWebContent(page, options, harness.deps);
  if ('type' in result) {
    throw new Error(
      `the pipeline failed with ${result.type}: ${result.message}`,
    );
  }

  return result;
}

describe('renderWebDocument', () => {
  it('takes a negotiated Markdown body as served', () => {
    const body = '# Adapter pipelines\n\nServed by the publisher for agents.\n';

    const render = renderWebDocument(
      response('text/markdown; charset=utf-8', body),
      {
        raw: false,
      },
    );

    expect(render.method).toBe('negotiated');
    expect(render.content).toBe(body);
    expect(render.notes).toBeUndefined();
  });

  it('accepts a media type with whitespace before its parameters', () => {
    const body = '# Adapter pipelines\n\nServed by the publisher for agents.\n';

    const markdown = renderWebDocument(
      response('text/markdown ; charset=utf-8', body),
      { raw: false },
    );
    const html = renderWebDocument(
      response('text/html ; charset=utf-8', ARTICLE_HTML),
      { raw: false },
    );

    expect(markdown.method).toBe('negotiated');
    expect(markdown.content).toBe(body);
    expect(html.method).toBe('readability');
    expect(html.content).toContain('## Negotiation');
  });

  it('takes a negotiated plain-text body as served', () => {
    const body = 'Adapter pipelines\n\nServed as plain text for agents.\n';

    const render = renderWebDocument(response('text/plain', body), {
      raw: false,
    });

    expect(render.method).toBe('negotiated');
    expect(render.content).toBe(body);
    expect(render.notes).toBeUndefined();
  });

  it('returns a JSON body unchanged as text', () => {
    const body = '{"steps":[{"method":"negotiated"},{"method":"readability"}]}';

    const render = renderWebDocument(response('application/json', body), {
      raw: false,
    });

    expect(render.method).toBe('text');
    expect(render.content).toBe(body);
  });

  it('returns an application/xml body unchanged as text', () => {
    const render = renderWebDocument(
      response('application/xml; charset=utf-8', RSS_XML),
      { raw: false },
    );

    expect(render.method).toBe('text');
    expect(render.content).toBe(RSS_XML);
  });

  it('returns a text/xml body unchanged as text', () => {
    const render = renderWebDocument(response('text/xml', NOTE_XML), {
      raw: false,
    });

    expect(render.method).toBe('text');
    expect(render.content).toBe(NOTE_XML);
  });

  it('renders an application/xhtml+xml document with Readability', () => {
    const render = renderWebDocument(
      response('application/xhtml+xml', XHTML_DOCUMENT),
      { raw: false },
    );

    expect(render.method).toBe('readability');
    expect(render.content).toContain('## An XHTML document renders locally');
    expect(render.content).toContain('extracts the article with Readability');
    expect(render.content).not.toContain('<article>');
  });

  it('renders a text/plain body that is HTML-shaped', () => {
    const render = renderWebDocument(
      response('text/plain', PLAIN_SERVED_HTML),
      {
        raw: false,
      },
    );

    expect(render.method).toBe('readability');
    expect(render.content).toContain('## Rendered from a text/plain response');
    expect(render.content).toContain('renders its main content instead');
    expect(render.content).not.toContain('<article>');
  });

  it('renders an article to Markdown with GFM tables, fenced code, and links', () => {
    const render = renderWebDocument(response('text/html', ARTICLE_HTML), {
      raw: false,
    });

    expect(render.method).toBe('readability');
    expect(render.notes).toBeUndefined();
    expect(render.content).toContain('## Negotiation');
    expect(render.content).toContain('| Step | Method |');
    expect(render.content).toContain('| --- | --- |');
    expect(render.content).toContain(
      '```\nconst article = new Readability(document).parse();\n```',
    );
    expect(render.content).toContain(
      '[read reference](https://docs.example.test/reference/read)',
    );
    expect(render.content).not.toContain('Guides');
    expect(render.content).not.toContain('Terms');
    expect(render.content).not.toContain('Privacy');
  });

  it('renders a markup fragment that has no html root', () => {
    const render = renderWebDocument(response('text/html', FRAGMENT_HTML), {
      raw: false,
    });

    expect(render.method).toBe('readability');
    expect(render.content).toContain('## Fragment render');
    expect(render.content).toContain('extracts the main content locally');
    expect(render.content).not.toContain('<div>');
  });

  it('renders a fragment whose root holds a stray body element', () => {
    // The fragment root is not `html`, so the served markup is wrapped before
    // Readability sees it; the prose outside the stray body element survives.
    const render = renderWebDocument(
      response('text/html', STRAY_BODY_FRAGMENT_HTML),
      { raw: false },
    );

    expect(render.method).toBe('readability');
    expect(render.content).toContain('extracts the main content locally');
    expect(render.content).not.toContain('<p>');
  });

  it('renders an html document whose body holds no elements', () => {
    // An empty body holds no text of its own, so the head's title is all the
    // page has: the wrapper is what puts it in front of Readability.
    const render = renderWebDocument(response('text/html', BODY_LESS_HTML), {
      raw: false,
    });

    expect(render.method).toBe('readability');
    expect(render.content).toContain('negotiation, local render');
  });

  it('converts the whole body when Readability finds no article', () => {
    const render = renderWebDocument(response('text/html', IMAGE_INDEX_HTML), {
      raw: false,
    });

    expect(render.method).toBe('readability');
    expect(render.content).toContain(
      '![Negotiation: ranking publisher Markdown above HTML](/img/one.png)',
    );
    expect(render.content).toContain(
      '![Raw body: the last resort when every conversion fails](/img/three.png)',
    );
  });

  it('falls back to the raw body with a note when the render fails the gate', () => {
    const render = renderWebDocument(response('text/html', NAV_ONLY_HTML), {
      raw: false,
    });

    expect(render.method).toBe('raw');
    expect(render.content).toBe(NAV_ONLY_HTML);
    expect(render.notes).toHaveLength(1);
    expect(render.notes?.[0]).toMatch(/could not be converted/i);
  });

  it('names a detected JavaScript challenge in the raw fallback', () => {
    const render = renderWebDocument(response('text/html', CHALLENGE_HTML), {
      raw: false,
    });

    expect(render.method).toBe('raw');
    expect(render.content).toBe(CHALLENGE_HTML);
    expect(render.notes).toHaveLength(2);
    expect(render.notes?.[1]).toMatch(/challenge/i);
    expect(render.notes?.[1]).toMatch(/enable javascript/i);
  });

  it('names a challenge that only the converted text carries', () => {
    const render = renderWebDocument(
      response('text/html', SPLIT_CHALLENGE_HTML),
      { raw: false },
    );

    expect(render.method).toBe('raw');
    expect(render.content).toBe(SPLIT_CHALLENGE_HTML);
    expect(render.notes).toHaveLength(2);
    expect(render.notes?.[1]).toMatch(/detected \(captcha\)/i);
  });

  it('names a challenge that only the served body carries', () => {
    const render = renderWebDocument(
      response('text/html', COMMENT_CHALLENGE_HTML),
      { raw: false },
    );

    expect(render.method).toBe('raw');
    expect(render.content).toBe(COMMENT_CHALLENGE_HTML);
    expect(render.notes).toHaveLength(2);
    expect(render.notes?.[1]).toMatch(/detected \(verify you are human\)/i);
  });

  it('returns the body untouched in raw mode', () => {
    const render = renderWebDocument(response('text/html', ARTICLE_HTML), {
      raw: true,
    });

    expect(render.method).toBe('raw');
    expect(render.content).toBe(ARTICLE_HTML);
    expect(render.notes).toBeUndefined();
  });

  it('falls back to the raw body when the HTML body is empty', () => {
    const render = renderWebDocument(response('text/html', '   \n '), {
      raw: false,
    });

    expect(render.method).toBe('raw');
    expect(render.content).toBe('   \n ');
    expect(render.notes).toHaveLength(1);
    expect(render.notes?.[0]).toMatch(/could not be converted/i);
  });
});

describe('passesQualityGate', () => {
  // Exactly 40 characters is not short and 39 is, so the line bound itself is
  // pinned rather than merely bracketed.
  const LONG_LINE = 'b'.repeat(40);
  const SHORT_LINE = 'a'.repeat(39);

  const lines = (longCount: number): string =>
    [
      ...Array.from({ length: longCount }, () => LONG_LINE),
      ...Array.from({ length: 10 - longCount }, () => SHORT_LINE),
    ].join('\n');

  it('requires more than 100 non-whitespace characters', () => {
    expect(passesQualityGate('a'.repeat(100))).toBe(false);
    expect(passesQualityGate('a'.repeat(101))).toBe(true);
  });

  it('fails only when more than 70 percent of the non-blank lines are short', () => {
    expect(passesQualityGate(lines(3))).toBe(true);
    expect(passesQualityGate(lines(2))).toBe(false);
  });

  it('counts only lines that hold text', () => {
    // Seven short and three long lines are exactly 70 percent short, so the
    // text passes; a blank line counted as a short line would tip it over.
    const text = [
      SHORT_LINE,
      '',
      LONG_LINE,
      SHORT_LINE,
      '  ',
      LONG_LINE,
      SHORT_LINE,
      '',
      LONG_LINE,
      SHORT_LINE,
      SHORT_LINE,
      SHORT_LINE,
      SHORT_LINE,
    ].join('\n');

    expect(passesQualityGate(text)).toBe(true);
  });

  it('measures every line after trimming its whitespace', () => {
    // Eight lines padded to 40 characters but holding 39 of text are short, so
    // the text fails; measuring the padding instead would pass it.
    const padded = ` ${'a'.repeat(39)}`;
    const text = [
      ...Array.from({ length: 8 }, () => padded),
      ...Array.from({ length: 2 }, () => LONG_LINE),
    ].join('\n');

    expect(passesQualityGate(text)).toBe(false);
  });

  it('treats a gate phrase under 1,024 characters as low quality', () => {
    const shortBody = `${'a'.repeat(1023 - 'captcha'.length)}captcha`;

    expect(passesQualityGate(shortBody)).toBe(false);
    expect(passesQualityGate(`${shortBody}a`)).toBe(true);
  });

  it('measures the gate-phrase bound after trimming the surrounding whitespace', () => {
    const paddedBody = `\n${'a'.repeat(1023 - 'captcha'.length)}captcha\n`;

    expect(passesQualityGate(paddedBody)).toBe(false);
  });
});

describe('renderWebContent', () => {
  /** The page URL the pipeline resolves every derived locator against. */
  const PAGE = BASE_URL;

  /** `ARTICLE_HTML` plus the head declaration the alternate adapter reads. */
  const ARTICLE_WITH_HEAD_ALTERNATE_HTML = ARTICLE_HTML.replace(
    '<head>',
    '<head><link rel="alternate" type="text/markdown" href="/guides/adapter-pipelines.md">',
  );

  /** The same announcement inside the body, where markup a contributor wrote —
   *  a comment, an issue body — lands on a page that renders it. */
  const ARTICLE_WITH_BODY_ALTERNATE_HTML = ARTICLE_HTML.replace(
    '<body>',
    '<body><link rel="alternate" type="text/markdown" href="/injected.md">',
  );

  /** The same announcement inside a bare fragment, which the wrapper re-parse
   *  puts in a `body` the head never holds. */
  const FRAGMENT_WITH_ALTERNATE_HTML = FRAGMENT_HTML.replace(
    '<div>',
    '<div><link rel="alternate" type="text/markdown" href="/injected.md">',
  );

  const linkHeader = (target: string, relation = 'alternate'): string =>
    `<${target}>; rel="${relation}"; type="text/markdown"`;

  it('fetches a Markdown alternate announced by the Link header', async () => {
    const alternate = `${PAGE}.md`;
    const harness = makePipeline({
      [alternate]: response('text/markdown', PUBLISHER_MARKDOWN, alternate),
    });

    const render = await runPipeline(
      response('text/html', ARTICLE_HTML, PAGE, linkHeader(alternate)),
      harness,
    );

    expect(render.method).toBe('alternate');
    expect(render.content).toBe(PUBLISHER_MARKDOWN);
    expect(render.finalUrl).toBe(alternate);
    expect(harness.requested).toEqual([alternate]);
  });

  it.each([
    ['a relation that is not an alternate', linkHeader(PAGE, 'canonical')],
    [
      'a type that is not Markdown',
      '<%s>; rel="alternate"; type="application/pdf"',
    ],
    ['a value that carries no target', 'rel="alternate"; type="text/markdown"'],
  ])('ignores a Link header carrying %s', async (_name, header) => {
    const alternate = 'https://docs.example.test/md/guide.md';
    const harness = makePipeline({});

    const render = await runPipeline(
      response(
        'text/html',
        ARTICLE_HTML,
        PAGE,
        header.replace('%s', alternate),
      ),
      harness,
    );

    expect(render.method).toBe('readability');
    expect(harness.requested).not.toContain(alternate);
  });

  it('fetches a head alternate resolved against the page URL', async () => {
    const alternate = `${PAGE}.md`;
    const harness = makePipeline({
      [alternate]: response('text/markdown', PUBLISHER_MARKDOWN, alternate),
    });

    const render = await runPipeline(
      response('text/html', ARTICLE_WITH_HEAD_ALTERNATE_HTML, PAGE),
      harness,
    );

    expect(render.method).toBe('alternate');
    expect(render.content).toBe(PUBLISHER_MARKDOWN);
    expect(render.finalUrl).toBe(alternate);
    expect(harness.requested).toEqual([alternate]);
  });

  it.each([
    ['a body', ARTICLE_WITH_BODY_ALTERNATE_HTML, '## Negotiation'],
    ['a wrapped fragment', FRAGMENT_WITH_ALTERNATE_HTML, '## Fragment render'],
  ])('ignores an alternate link in %s', async (_name, html, prose) => {
    const injected = 'https://docs.example.test/injected.md';
    // The injected locator answers with Markdown, so only the head scoping
    // keeps it from becoming the content: markup a contributor wrote must not
    // choose what the read returns.
    const harness = makePipeline({
      [injected]: response('text/markdown', PUBLISHER_MARKDOWN, injected),
    });

    const render = await runPipeline(
      response('text/html', html, PAGE),
      harness,
    );

    expect(render.method).toBe('readability');
    expect(render.content).toContain(prose);
    expect(harness.requested).not.toContain(injected);
  });

  it('reads a relation and type spelled differently, and finds a later value', async () => {
    const alternate = `${PAGE}.md`;
    const harness = makePipeline({
      [alternate]: response('text/markdown', PUBLISHER_MARKDOWN, alternate),
    });
    // A non-alternate value first, an unquoted relation, and a parameterized
    // type in another case: the second value is the announcement.
    const header = [
      '<https://docs.example.test/api>; rel=describedby; type=application/json',
      `<${alternate}>; rel="Alternate"; type="TEXT/MARKDOWN; charset=utf-8"`,
    ].join(', ');

    const render = await runPipeline(
      response('text/html', ARTICLE_HTML, PAGE, header),
      harness,
    );

    expect(render.method).toBe('alternate');
    expect(harness.requested).toEqual([alternate]);
  });

  it('drops the fragment of an announced alternate before admission and request', async () => {
    const alternate = `${PAGE}.md`;
    const harness = makePipeline({
      [alternate]: response('text/markdown', PUBLISHER_MARKDOWN, alternate),
    });

    const render = await runPipeline(
      response(
        'text/html',
        ARTICLE_HTML,
        PAGE,
        linkHeader(`${alternate}#section`),
      ),
      harness,
    );

    // A fragment never leaves the process, so admission and the request see
    // the fragment-free text — the locator the hop path would hand the client.
    expect(render.method).toBe('alternate');
    expect(render.finalUrl).toBe(alternate);
    expect(harness.admitted).toEqual([alternate]);
    expect(harness.requested).toEqual([alternate]);
  });

  it('blocks a fragment-bearing announcement with a reject on the fragment-free URL', async () => {
    const target = 'https://blocked.example/doc';
    // The reject clause names the URL the request would use; the announcement
    // carries a fragment, which the request would drop.
    const harness = makePipeline(
      { [target]: response('text/markdown', PUBLISHER_MARKDOWN, target) },
      [target],
    );

    const render = await runPipeline(
      response(
        'text/html',
        ARTICLE_HTML,
        PAGE,
        linkHeader(`${target}#section`),
      ),
      harness,
    );

    // The candidate is admitted as the text the clause matches, so the blocked
    // resource is never requested; the page's own suffix probe is the only
    // request the call makes.
    expect(harness.admitted).toContain(target);
    expect(render.method).toBe('readability');
    expect(harness.requested).toEqual([`${PAGE}.md`]);
  });

  it.each([
    ['a non-web target', '<file:///etc/passwd>'],
    ['a target that is not a URL', '<https://>'],
    ['an empty target', '<   >'],
    [
      'a target that carries credentials',
      '<https://user:secret@evil.test/page.md>',
    ],
  ])('ignores an announced alternate with %s', async (_name, target) => {
    const harness = makePipeline({});

    const render = await runPipeline(
      response(
        'text/html',
        ARTICLE_HTML,
        PAGE,
        `${target}; rel="alternate"; type="text/markdown"`,
      ),
      harness,
    );

    expect(render.method).toBe('readability');
    // Only the suffix probe was issued: the announcement never became a
    // request of its own.
    expect(harness.requested).toEqual([`${PAGE}.md`]);
  });

  it('ignores an announced alternate that carries credentials', async () => {
    const announced = 'https://user:secret@evil.test/page.md';
    // The real client cannot construct this request and repeats the URL
    // verbatim in its `network_error`, so admitting the announcement would put
    // the credential into the result the model reads.
    const harness = makePipeline({
      [announced]: {
        type: 'network_error',
        message: `Request cannot be constructed from a URL that includes credentials: ${announced}`,
      },
    });

    const render = await runPipeline(
      response('text/html', ARTICLE_HTML, PAGE, linkHeader(announced)),
      harness,
    );

    expect(render.method).toBe('readability');
    // The refused announcement never became a request, and nothing that came
    // out of the call names the credential or the host it pointed at.
    expect(harness.requested).toEqual([`${PAGE}.md`]);
    expect(JSON.stringify(render)).not.toContain('secret');
    expect(JSON.stringify(render)).not.toContain('evil.test');
  });

  it.each([
    [
      'https://docs.example.test/a/b.html',
      'https://docs.example.test/a/b.html.md',
    ],
    ['https://docs.example.test/a/b', 'https://docs.example.test/a/b.md'],
    [
      'https://docs.example.test/a/b/',
      'https://docs.example.test/a/b/index.md',
    ],
  ])('probes the Markdown suffix of %s', async (pageUrl, candidate) => {
    const harness = makePipeline({
      [candidate]: response('text/markdown', PUBLISHER_MARKDOWN, candidate),
    });

    const render = await runPipeline(
      response('text/html', ARTICLE_HTML, pageUrl),
      harness,
    );

    expect(render.method).toBe('md-suffix');
    expect(render.content).toBe(PUBLISHER_MARKDOWN);
    expect(render.finalUrl).toBe(candidate);
    expect(harness.requested).toEqual([candidate]);
  });

  it('reports where a probe landed when the probe itself followed a redirect', async () => {
    const alternate = `${PAGE}.md`;
    const landed = 'https://cdn.example.test/guides/adapter-pipelines.md';
    const harness = makePipeline({
      [alternate]: response('text/markdown', PUBLISHER_MARKDOWN, landed),
    });

    const render = await runPipeline(
      response('text/html', ARTICLE_HTML, PAGE, linkHeader(alternate)),
      harness,
    );

    expect(render.method).toBe('alternate');
    // The probe's own response, not the URL the pipeline requested, is where
    // the content came from.
    expect(render.finalUrl).toBe(landed);
  });

  it('renders the page when the suffix probe finds nothing', async () => {
    const harness = makePipeline({});

    const render = await runPipeline(
      response('text/html', ARTICLE_HTML, PAGE),
      harness,
    );

    expect(render.method).toBe('readability');
    expect(render.content).toContain('## Negotiation');
    expect(render.finalUrl).toBeUndefined();
    expect(harness.requested).toEqual([`${PAGE}.md`]);
  });

  it('disqualifies a candidate whose content type the client refused', async () => {
    const harness = makePipeline({
      [`${PAGE}.md`]: {
        type: 'unsupported_content_type',
        message: 'Unsupported content type "application/pdf".',
      },
    });

    const render = await runPipeline(
      response('text/html', ARTICLE_HTML, PAGE),
      harness,
    );

    expect(render.method).toBe('readability');
  });

  it('disqualifies a Markdown candidate that is markup', async () => {
    // Long and line-wise nothing like a stub, so only the shape test keeps an
    // HTML error page from becoming the content.
    const errorPage = `<html><body><p>${'not found here '.repeat(20)}</p></body></html>`;
    const harness = makePipeline({
      [`${PAGE}.md`]: response('text/html', errorPage, `${PAGE}.md`),
    });

    const render = await runPipeline(
      response('text/html', ARTICLE_HTML, PAGE),
      harness,
    );

    expect(render.method).toBe('readability');
  });

  it('probes the suffix of the path, without the page query or fragment', async () => {
    const candidate = 'https://docs.example.test/a/b.md';
    const harness = makePipeline({
      [candidate]: response('text/markdown', PUBLISHER_MARKDOWN, candidate),
    });

    const render = await runPipeline(
      response(
        'text/html',
        ARTICLE_HTML,
        'https://docs.example.test/a/b?x=1#top',
      ),
      harness,
    );

    expect(render.method).toBe('md-suffix');
    expect(harness.requested).toEqual([candidate]);
  });

  it('probes nothing for a page that is not a web locator', async () => {
    // The client only ever reports an http(s) final URL, so this is the
    // fail-safe: a locator the tool could not have fetched derives nothing.
    const harness = makePipeline({});

    const render = await runPipeline(
      response('text/html', ARTICLE_HTML, 'file:///etc/passwd'),
      harness,
    );

    expect(render.method).toBe('readability');
    expect(harness.requested).toEqual([]);
  });

  it('skips a refused alternate without failing the call', async () => {
    const alternate = 'https://evil.example/guide.md';
    const harness = makePipeline({}, [alternate]);

    const render = await runPipeline(
      response('text/html', ARTICLE_HTML, PAGE, linkHeader(alternate)),
      harness,
    );

    // Decided before any request, and the call still ends with content.
    expect(harness.admitted).toContain(alternate);
    expect(harness.requested).not.toContain(alternate);
    expect(render.method).toBe('readability');
  });

  it('walks llms.txt from the page scope to the root after a gated render', async () => {
    const pageUrl = 'https://docs.example.test/a/b/c';
    const root = 'https://docs.example.test/llms.txt';
    const harness = makePipeline({
      [root]: response('text/plain', LLMS_TXT, root),
    });

    const render = await runPipeline(
      response('text/html', NAV_ONLY_HTML, pageUrl),
      harness,
    );

    expect(render.method).toBe('llms-txt');
    expect(render.content).toBe(LLMS_TXT);
    expect(render.finalUrl).toBe(root);
    expect(harness.requested).toEqual([
      `${pageUrl}.md`,
      `${pageUrl}/llms.txt`,
      'https://docs.example.test/a/b/llms.txt',
      'https://docs.example.test/a/llms.txt',
      root,
    ]);
  });

  it('leaves the raw fallback standing when an llms.txt candidate fails on its own', async () => {
    const pageUrl = 'https://docs.example.test/a/b/c';
    const failure: WebFetchFailure = {
      type: 'network_error',
      message: 'The transport failed.',
    };
    const harness = makePipeline({ [`${pageUrl}/llms.txt`]: failure });

    const render = await runPipeline(
      response('text/html', NAV_ONLY_HTML, pageUrl),
      harness,
    );

    // A candidate-local failure — here the page's own scope answering
    // `network_error` — is the candidate's own answer and cannot cost the call
    // the fallback it already holds.
    expect(render.method).toBe('raw');
    expect(render.content).toBe(NAV_ONLY_HTML);
  });

  it.each([
    ['call_timeout', 'The web read exceeded its 30-second budget.'],
    ['too_many_redirects', 'The read followed more than 20 redirects.'],
    [
      'permission_denied',
      'A redirect target was refused before its content was read.',
    ],
  ])(
    'fails the call when an llms.txt candidate answers %s',
    async (type, message) => {
      const pageUrl = 'https://docs.example.test/a/b/c';
      const failure: WebFetchFailure = { type, message };
      const harness = makePipeline({ [`${pageUrl}/llms.txt`]: failure });

      const result = await renderWebContent(
        response('text/html', NAV_ONLY_HTML, pageUrl),
        { raw: false },
        harness.deps,
      );

      // A bound of the call is spent, so the walk stops there and the render
      // the call already holds is not what it reports.
      expect(result).toStrictEqual(failure);
      expect(harness.requested).toEqual([
        `${pageUrl}.md`,
        `${pageUrl}/llms.txt`,
      ]);
    },
  );

  it('bounds the call to one alternate, one suffix probe, and four llms.txt candidates', async () => {
    const pageUrl = 'https://docs.example.test/a/b/c/d';
    const alternate = `${pageUrl}.md`;
    const harness = makePipeline({});

    const render = await runPipeline(
      response('text/html', NAV_ONLY_HTML, pageUrl, linkHeader(alternate)),
      harness,
    );

    expect(render.method).toBe('raw');
    expect(render.finalUrl).toBeUndefined();
    expect(harness.requested).toEqual([
      alternate,
      `${pageUrl}.md`,
      `${pageUrl}/llms.txt`,
      'https://docs.example.test/a/b/c/llms.txt',
      'https://docs.example.test/a/b/llms.txt',
      'https://docs.example.test/llms.txt',
    ]);
    expect(
      harness.requested.filter((url) => url.endsWith('llms.txt')),
    ).toHaveLength(4);
  });

  it('ends the call when a probe fails for more than its own candidate', async () => {
    const failure: WebFetchFailure = {
      type: 'too_many_redirects',
      message: 'The read followed more than 20 redirects.',
    };
    const harness = makePipeline({ [`${PAGE}.md`]: failure });

    const result = await renderWebContent(
      response('text/html', ARTICLE_HTML, PAGE),
      { raw: false },
      harness.deps,
    );

    expect(result).toStrictEqual(failure);
  });

  it.each([
    [
      'a negotiated Markdown body',
      'text/markdown',
      PUBLISHER_MARKDOWN,
      'negotiated',
    ],
    [
      'a negotiated plain-text body',
      'text/plain',
      PUBLISHER_MARKDOWN,
      'negotiated',
    ],
    [
      'a body outside the negotiation set',
      'application/json',
      '{"a":1}',
      'text',
    ],
  ])('issues no probe for %s', async (_name, contentType, body, method) => {
    const harness = makePipeline({});

    const render = await runPipeline(
      response(contentType, body, PAGE),
      harness,
    );

    expect(render.method).toBe(method);
    expect(render.finalUrl).toBeUndefined();
    expect(harness.requested).toEqual([]);
  });

  it('makes no probe request in raw mode', async () => {
    const harness = makePipeline({});

    const render = await runPipeline(
      response('text/html', ARTICLE_HTML, PAGE, linkHeader(`${PAGE}.md`)),
      harness,
      { raw: true },
    );

    expect(render.finalUrl).toBeUndefined();
    expect(render).toStrictEqual({ method: 'raw', content: ARTICLE_HTML });
    expect(harness.requested).toEqual([]);
  });
});
