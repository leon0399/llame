import { describe, expect, it } from 'vitest';

import type { WebFetchFailure, WebResponse } from '../../http-client';
import { scriptedIo, type Reply } from '../../../../testing/github-test-io';
import { createWikipediaAdapter } from './adapter';

const adapter = createWikipediaAdapter({ id: 'wikipedia', use: 'wikipedia' });
const API = 'https://en.wikipedia.org/w/rest.php/v1/page';

function html(body: string): WebResponse {
  return {
    finalUrl: `${API}/Rust/html`,
    contentType: 'text/html; charset=utf-8',
    body: `<!DOCTYPE html><html><head><title>Rust (language)</title><style>.x{}</style></head><body>${body}</body></html>`,
  };
}

async function read(source: string, reply: Reply, url = `${API}/Rust/html`) {
  const run = scriptedIo(new Map([[url, [reply]]]));
  const outcome = await adapter.read(new URL(source), run.io);
  return { outcome, urls: run.requests.map((request) => request.url) };
}

describe('Wikipedia adapter claim', () => {
  it.each([
    ['https://en.wikipedia.org/wiki/Rust', `${API}/Rust/html`],
    ['https://en.m.wikipedia.org/wiki/Rust', `${API}/Rust/html`],
    [
      'https://en.wikipedia.org/wiki/Rust_(programming_language)#History',
      `${API}/Rust_(programming_language)/html`,
    ],
    [
      'https://de.wikipedia.org/wiki/Rust_%28Programmiersprache%29',
      'https://de.wikipedia.org/w/rest.php/v1/page/Rust_(Programmiersprache)/html',
    ],
    [
      'https://en.wikipedia.org/wiki/Star_Wars:_Episode_IV',
      `${API}/Star_Wars%3A_Episode_IV/html`,
    ],
    ['https://en.wikipedia.org/wiki/AC%2FDC', `${API}/AC%2FDC/html`],
  ])('claims %s', async (source, url) => {
    expect(adapter.match(new URL(source))).toBe(true);
    const { urls } = await read(source, html('<p>x</p>'), url);
    expect(urls).toStrictEqual([url]);
  });

  it.each([
    'http://en.wikipedia.org/wiki/Rust',
    'https://wikipedia.org/wiki/Rust',
    'https://www.wikipedia.org/',
    'https://en.wikipedia.org/w/index.php?title=Rust',
    'https://en.wikipedia.org/wiki/',
    'https://en.wikipedia.org/wiki/Special:Random',
    'https://en.wikipedia.org/wiki/Talk:Rust',
    'https://en.wikipedia.org/wiki/File:Rust_logo.svg',
    'https://en.wikipedia.org/wiki/Category:Programming_languages',
    'https://en.wikipedia.org/wiki/%E0%A4%A',
    'https://en.wikipedia.org.evil.test/wiki/Rust',
  ])('leaves %s to the generic ladder', (source) => {
    expect(adapter.match(new URL(source))).toBe(false);
  });
});

describe('Wikipedia adapter read', () => {
  it('renders the article without citations, navigation, or infobox', async () => {
    const { outcome } = await read(
      'https://en.wikipedia.org/wiki/Rust',
      html(
        [
          '<table class="infobox"><tr><td>Developer</td></tr></table>',
          '<div class="hatnote">For the fungus, see Rust (fungus).</div>',
          '<p><b>Rust</b> is a <a href="./Programming_language" title="Programming language">language</a>.<sup class="reference"><a href="#cite_note-1">[1]</a></sup></p>',
          '<section><h2 id="Syntax">Syntax</h2><span class="mw-editsection">edit</span>',
          '<pre id="mwA1">fn main() { let a = [1, 2]; }</pre></section>',
          '<figure><img src="//upload.example/x.png"></figure>',
          '<div class="navbox">Rust navigation</div>',
          '<div class="mw-references-wrap"><ol><li>Ref one</li></ol></div>',
        ].join(''),
      ),
    );

    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '# Rust (language)',
        '',
        'URL: https://en.wikipedia.org/wiki/Rust_(language)',
        '',
        '**Rust** is a [language](https://en.wikipedia.org/wiki/Programming_language).',
        '',
        '## Syntax',
        '',
        '```',
        'fn main() { let a = [1, 2]; }',
        '```',
      ].join('\n'),
    });
  });

  it('falls through on a missing article or an empty body', async () => {
    const missing: WebFetchFailure = {
      type: 'http_status',
      message: 'HTTP 404',
      httpStatus: 404,
    };
    const source = 'https://en.wikipedia.org/wiki/Rust';

    await expect(read(source, missing)).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'status' },
    });
    await expect(
      read(source, html('<div class="navbox">only</div>')),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'empty' } });
  });
});
