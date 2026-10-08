import type { TelegramWebAdapterConfig } from '../../../../instance-config/llame-config';
import {
  primaryFailure,
  type WebAdapter,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from '../contract';
import {
  renderChannelPage,
  renderWidgetPost,
  type TelegramRender,
} from './render';

const HOST = /^(?:t\.me|telegram\.me|telegram\.dog)$/u;
/** `/{name}`, `/s/{name}`, `/{name}/{id}`, or `/s/{name}/{id}`. */
const LOCATOR =
  /^\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,31})(?:\/([1-9][0-9]{0,9}))?$/u;
const ID = /^[1-9][0-9]{0,9}$/u;

type TelegramTarget =
  | { readonly kind: 'private' }
  | { readonly kind: 'post'; readonly name: string; readonly id: string }
  | { readonly kind: 'channel'; readonly name: string };

/** Matches a public Telegram post or channel locator, or a private `/c/`
 *  link, which is claimed only to be declined before any request. */
export function parseTelegramUrl(source: URL): TelegramTarget | undefined {
  if (
    source.protocol !== 'https:' ||
    source.port !== '' ||
    !HOST.test(source.hostname)
  ) {
    return undefined;
  }
  if (source.pathname.startsWith('/c/')) return { kind: 'private' };
  const match = LOCATOR.exec(source.pathname);
  const name = match?.[1];
  if (name === undefined) return undefined;
  const id = match?.[2];
  return id === undefined
    ? { kind: 'channel', name }
    : { kind: 'post', name, id };
}

/** Creates the native Telegram adapter. */
export function createTelegramAdapter(
  config: TelegramWebAdapterConfig,
): WebAdapter {
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseTelegramUrl(source) !== undefined,
    read: async (source, io) => {
      const target = parseTelegramUrl(source)!;
      if (target.kind === 'private') {
        return { kind: 'failed', failure: 'address' };
      }
      const result =
        target.kind === 'post'
          ? await readPost(target.name, target.id, io)
          : await readChannel(target.name, source.searchParams, io);
      if ('kind' in result) return result;
      return 'failure' in result
        ? { kind: 'failed', failure: result.failure }
        : {
            kind: 'rendered',
            content: result.content,
            mediaType: 'text/markdown',
            notes: [],
          };
    },
  };
}

/** One post through the Post Widget; a query on the source is ignored. */
async function readPost(
  name: string,
  id: string,
  io: WebAdapterIo,
): Promise<WebAdapterOutcome | TelegramRender> {
  const fetched = await io.fetch(
    `https://t.me/${name}/${id}?embed=1&mode=tme`,
    { accept: 'text/html' },
  );
  return 'type' in fetched
    ? primaryFailure(fetched)
    : renderWidgetPost(fetched.body);
}

/** A channel page through the web preview. A user, bot, group, or unknown
 *  name redirects away from `/s/{name}`. */
async function readChannel(
  name: string,
  params: URLSearchParams,
  io: WebAdapterIo,
): Promise<WebAdapterOutcome | TelegramRender> {
  const cursor = channelCursor(params);
  if (cursor === undefined) return { kind: 'failed', failure: 'address' };
  const url = `https://t.me/s/${name}${cursor}`;
  const fetched = await io.fetch(url, { accept: 'text/html' });
  if ('type' in fetched) return primaryFailure(fetched);
  if (new URL(fetched.finalUrl).pathname !== `/s/${name}`) {
    return { kind: 'failed', failure: 'status' };
  }
  return renderChannelPage(fetched.body, url);
}

/** The forwarded cursor (`?before=N` or `?after=N`, or none), or `undefined`
 *  when the query asks for a search or holds a conflicting or malformed
 *  cursor. Every other key is dropped. */
function channelCursor(params: URLSearchParams): string | undefined {
  if (params.has('q')) return undefined;
  const [cursor, ...rest] = [...params].filter(
    ([key]) => key === 'before' || key === 'after',
  );
  if (cursor === undefined) return '';
  if (rest.length > 0 || !ID.test(cursor[1])) return undefined;
  return `?${cursor[0]}=${cursor[1]}`;
}
