import type { BlueskyWebAdapterConfig } from '../../../../instance-config/llame-config';
import type { WebFetchFailure, WebResponse } from '../../http-client';
import {
  isFatalAdapterFailure,
  omissionNote,
  primaryFailure,
  type WebAdapter,
  type WebAdapterOutcome,
} from '../contract';
import {
  parseAuthorFeed,
  parseProfile,
  renderFollowList,
  renderProfile,
  renderThread,
  type BlueskyRender,
} from './render';

/** Bluesky's unauthenticated AppView; it serves public reads without a key. */
export const BLUESKY_API_ORIGIN = 'https://public.api.bsky.app';
const LATEST_POSTS = '30';
const FOLLOW_PAGE_SIZE = '100';

type BlueskyTarget =
  | { readonly kind: 'post'; readonly actor: string; readonly rkey: string }
  | {
      readonly kind: 'profile' | 'followers' | 'follows';
      readonly actor: string;
    };

/** AT Protocol handle and DID syntax, and the record-key charset. */
const HANDLE = String.raw`(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?`;
const DID = 'did:[a-z]+:[A-Za-z0-9._:%-]*[A-Za-z0-9._-]';
const PROFILE_PATH = new RegExp(
  `^/profile/(${HANDLE}|${DID})(?:/post/([A-Za-z0-9._:~-]{1,512})|/(followers|follows))?$`,
  'u',
);
const MAX_HANDLE_LENGTH = 253;
const MAX_DID_LENGTH = 2048;

/** Matches the public bsky.app post, profile, followers, and follows URLs. */
export function parseBlueskyUrl(source: URL): BlueskyTarget | undefined {
  if (source.protocol !== 'https:' || source.host !== 'bsky.app') {
    return undefined;
  }
  const match = PROFILE_PATH.exec(source.pathname);
  const actor = match?.[1];
  if (match === null || actor === undefined) return undefined;
  const limit = actor.startsWith('did:') ? MAX_DID_LENGTH : MAX_HANDLE_LENGTH;
  if (actor.length > limit) return undefined;

  const [, , rkey, list] = match;
  if (rkey !== undefined) {
    return rkey === '.' || rkey === '..'
      ? undefined
      : { kind: 'post', actor, rkey };
  }
  return {
    kind: list === 'followers' || list === 'follows' ? list : 'profile',
    actor,
  };
}

/** Creates the native Bluesky adapter. */
export function createBlueskyAdapter(
  config: BlueskyWebAdapterConfig,
  options: { readonly apiOrigin?: string } = {},
): WebAdapter {
  const apiOrigin = options.apiOrigin ?? BLUESKY_API_ORIGIN;
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseBlueskyUrl(source) !== undefined,
    read: async (source, io) => {
      const target = parseBlueskyUrl(source)!;
      const xrpc = (method: string, params: Record<string, string>) =>
        io.fetch(`${apiOrigin}/xrpc/${method}?${new URLSearchParams(params)}`, {
          accept: 'application/json',
        });

      if (target.kind === 'profile') return readProfile(target.actor, xrpc);
      const fetched =
        target.kind === 'post'
          ? await xrpc('app.bsky.feed.getPostThread', {
              uri: `at://${target.actor}/app.bsky.feed.post/${target.rkey}`,
            })
          : await xrpc(
              target.kind === 'followers'
                ? 'app.bsky.graph.getFollowers'
                : 'app.bsky.graph.getFollows',
              { actor: target.actor, limit: FOLLOW_PAGE_SIZE },
            );
      if ('type' in fetched) return primaryFailure(fetched);
      return outcome(
        target.kind === 'post'
          ? renderThread(fetched.body)
          : renderFollowList(fetched.body, target.kind),
        [],
      );
    },
  };
}

type Xrpc = (
  method: string,
  params: Record<string, string>,
) => Promise<WebResponse | WebFetchFailure>;

/** The profile is primary; its latest posts are a secondary section whose
 *  failure leaves an omission note, as a GitHub list page does. */
async function readProfile(
  actor: string,
  xrpc: Xrpc,
): Promise<WebAdapterOutcome> {
  const fetched = await xrpc('app.bsky.actor.getProfile', { actor });
  if ('type' in fetched) return primaryFailure(fetched);
  const parsed = parseProfile(fetched.body);
  if ('failure' in parsed) return { kind: 'failed', failure: parsed.failure };

  const feed = await xrpc('app.bsky.feed.getAuthorFeed', {
    actor: parsed.profile.did,
    filter: 'posts_no_replies',
    limit: LATEST_POSTS,
  });
  if (!('type' in feed)) {
    const posts = parseAuthorFeed(feed.body);
    return outcome(
      { content: renderProfile(parsed.profile, posts) },
      posts === undefined ? ['posts omitted: parse'] : [],
    );
  }
  // A deadline reached after the profile keeps what arrived; any other
  // call-ending failure ends the read, as GitHub's secondary sections do.
  if (isFatalAdapterFailure(feed) && feed.type !== 'call_timeout') {
    return primaryFailure(feed);
  }
  return outcome({ content: renderProfile(parsed.profile, undefined) }, [
    omissionNote('posts', feed),
  ]);
}

function outcome(
  render: BlueskyRender,
  notes: ReadonlyArray<string>,
): WebAdapterOutcome {
  return 'failure' in render
    ? { kind: 'failed', failure: render.failure }
    : {
        kind: 'rendered',
        content: render.content,
        mediaType: 'text/markdown',
        notes,
      };
}
