import { describe, expect, it } from 'vitest';

import type { WebFetchFailure, WebResponse } from '../../http-client';
import { scriptedIo, type Reply } from '../../../../testing/github-test-io';
import { createTelegramAdapter } from './adapter';

const adapter = createTelegramAdapter({ id: 'telegram', use: 'telegram' });
const POST = 'https://t.me/durov/400?embed=1&mode=tme';
const CHANNEL = 'https://t.me/s/durov';
const WIDGET = [
  '<div class="tgme_widget_message" data-post="durov/400"><div class="tgme_widget_message_bubble">',
  '<div class="tgme_widget_message_author"><a class="tgme_widget_message_owner_name" href="https://t.me/durov"><span dir="auto">Pavel Durov</span></a></div>',
  '<div class="tgme_widget_message_text">Hello</div>',
  '<div class="tgme_widget_message_footer"><a class="tgme_widget_message_date" href="https://t.me/durov/400"><time datetime="2026-10-08T15:40:10+00:00"></time></a></div>',
  '</div></div>',
].join('');
const HEADER =
  '<div class="tgme_channel_info"><div class="tgme_channel_info_header_title"><span dir="auto">Pavel Durov</span></div><div class="tgme_channel_info_header_username"><a href="https://t.me/durov">@durov</a></div></div>';

function html(body: string, finalUrl = POST): WebResponse {
  return {
    finalUrl,
    contentType: 'text/html; charset=utf-8',
    body: `<!DOCTYPE html><html><head></head><body>${body}</body></html>`,
  };
}

async function read(source: string, reply: Reply, url = POST) {
  const run = scriptedIo(new Map([[url, [reply]]]));
  const outcome = await adapter.read(new URL(source), run.io);
  return { outcome, requests: run.requests };
}

describe('Telegram adapter claim', () => {
  it.each([
    ['https://telegram.me/durov/400?single', POST],
    ['https://telegram.dog/s/durov/400', POST],
    ['https://t.me/durov', CHANNEL],
    ['https://telegram.me/s/durov?utm_source=x', CHANNEL],
    ['https://t.me/s/durov?before=390', `${CHANNEL}?before=390`],
    ['https://t.me/s/durov?after=400&utm_source=x', `${CHANNEL}?after=400`],
  ])('claims %s and requests %s', async (source, url) => {
    expect(adapter.match(new URL(source))).toBe(true);
    const { requests } = await read(source, html(WIDGET, url), url);
    expect(requests).toStrictEqual([{ url, init: { accept: 'text/html' } }]);
  });

  it.each([
    'https://t.me/c/1234567/5',
    'https://t.me/s/durov?q=privacy',
    'https://t.me/s/durov?before=1&after=2',
    'https://t.me/s/durov?before=1&before=2',
    'https://t.me/s/durov?before=0',
    'https://t.me/s/durov?before=',
    'https://t.me/s/durov?before=390:1-40',
  ])('declines %s with address before any request', async (source) => {
    expect(adapter.match(new URL(source))).toBe(true);
    const run = scriptedIo(new Map());
    await expect(adapter.read(new URL(source), run.io)).resolves.toStrictEqual({
      kind: 'failed',
      failure: 'address',
    });
    expect(run.requests).toStrictEqual([]);
  });

  it.each([
    'http://t.me/durov/400',
    'https://t.me:8443/durov',
    'https://t.me/durov/400/',
    'https://t.me/joinchat/AbCdEf',
    'https://t.me/durov/0400',
    'https://t.me/s/',
    'https://example.com/durov',
  ])('leaves %s to the generic ladder', (source) => {
    expect(adapter.match(new URL(source))).toBe(false);
  });
});

describe('Telegram adapter read', () => {
  it('renders a post from the Post Widget', async () => {
    const { outcome } = await read('https://t.me/durov/400', html(WIDGET));

    expect(outcome).toMatchObject({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
    });
    expect(outcome.kind === 'rendered' && outcome.content).toContain(
      'Source: https://t.me/durov/400',
    );
  });

  it('renders a channel page from the web preview', async () => {
    const { outcome } = await read(
      'https://t.me/durov',
      html(
        `${HEADER}<div class="tgme_widget_message_wrap">${WIDGET}</div>`,
        CHANNEL,
      ),
      CHANNEL,
    );

    expect(outcome).toMatchObject({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
    });
    expect(
      outcome.kind === 'rendered' &&
        outcome.content.startsWith('# Pavel Durov (@durov)'),
    ).toBe(true);
  });

  it('falls through as status when the preview redirects away', async () => {
    const { outcome } = await read(
      'https://t.me/BotFather',
      html('', 'https://t.me/BotFather'),
      'https://t.me/s/BotFather',
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'status' });
  });

  it('falls through as empty on the widget error element', async () => {
    const { outcome } = await read(
      'https://t.me/durov/400',
      html('<div class="tgme_widget_message_error">Post not found</div>'),
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'empty' });
  });

  it('falls through as parse when the widget has no message or error', async () => {
    const { outcome } = await read(
      'https://t.me/durov/400',
      html('<div class="tgme_page">Telegram</div>'),
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'parse' });
  });

  it('maps a shared-client failure through the primary failure', async () => {
    const limited: WebFetchFailure = {
      type: 'http_status',
      message: 'HTTP 429',
      httpStatus: 429,
    };

    await expect(
      read('https://t.me/s/durov', limited, CHANNEL),
    ).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'rate_limit' },
    });
  });
});
