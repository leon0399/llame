import { passesQualityGate, renderWebDocument } from './pipeline';
import type { WebResponse } from './http-client';

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

const response = (
  contentType: string,
  body: string,
  finalUrl = BASE_URL,
): WebResponse => ({ finalUrl, contentType, body });

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

  it('treats a gate phrase under 1,024 characters as low quality', () => {
    const shortBody = `${'a'.repeat(1023 - 'captcha'.length)}captcha`;

    expect(passesQualityGate(shortBody)).toBe(false);
    expect(passesQualityGate(`${shortBody}a`)).toBe(true);
  });
});
