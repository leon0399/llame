import { z } from 'zod';

import type { LobstersWebAdapterConfig } from '../../../../instance-config/llame-config';
import { convertToMarkdown } from '../../pipeline';
import { parseJsonBody, primaryFailure, type WebAdapter } from '../contract';

/** Lobsters serves a story with its whole comment thread in one keyless JSON
 *  response. */
export const LOBSTERS_ORIGIN = 'https://lobste.rs';
/** `/s/{short_id}` or `/s/{short_id}/{slug}`. */
const STORY_PATH = /^\/s\/([a-z0-9]{1,16})(?:\/[a-z0-9_-]+)?$/u;

/** The API sends a text post's `url` as an empty string, and a removed
 *  comment's body as the site's own placeholder. */
const COMMENT = z.object({
  short_id: z.string(),
  parent_comment: z.string().nullable().default(null),
  score: z.number(),
  commenting_user: z.string().nullable().default(null),
  comment: z.string().nullable().default(null),
  created_at: z.string(),
});

const STORY = z.object({
  short_id: z.string(),
  title: z.string(),
  url: z
    .string()
    .nullable()
    .default(null)
    .transform((url) => url || null),
  description: z.string().nullable().default(null),
  score: z.number(),
  submitter_user: z.string().nullable().default(null),
  tags: z.array(z.string()),
  comments: z.array(COMMENT),
  created_at: z.string(),
});
type Comment = z.infer<typeof COMMENT>;
type Story = z.infer<typeof STORY>;

/** Matches `lobste.rs/s/{short_id}` and `lobste.rs/s/{short_id}/{slug}`. */
export function parseLobstersUrl(source: URL): string | undefined {
  if (source.protocol !== 'https:' || source.host !== 'lobste.rs') {
    return undefined;
  }
  return STORY_PATH.exec(source.pathname)?.[1];
}

/** Creates the native Lobsters adapter. */
export function createLobstersAdapter(
  config: LobstersWebAdapterConfig,
  options: { readonly origin?: string } = {},
): WebAdapter {
  const origin = options.origin ?? LOBSTERS_ORIGIN;
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseLobstersUrl(source) !== undefined,
    read: async (source, io) => {
      const shortId = parseLobstersUrl(source)!;
      const fetched = await io.fetch(`${origin}/s/${shortId}.json`, {
        accept: 'application/json',
      });
      if ('type' in fetched) return primaryFailure(fetched);
      // An admitted redirect may leave lobste.rs; only Lobsters' answer is a
      // story.
      if (new URL(fetched.finalUrl).origin !== origin) {
        return { kind: 'failed', failure: 'status' };
      }
      const story = parseJsonBody(fetched.body, STORY);
      if (story === undefined) return { kind: 'failed', failure: 'parse' };
      return {
        kind: 'rendered',
        content: renderThread(story),
        mediaType: 'text/markdown',
        notes: [],
      };
    },
  };
}

/** x.md's thread layout: the story, then every comment in the API's order,
 *  which is the site's thread order. */
function renderThread(story: Story): string {
  const authors = new Map(
    story.comments.map((comment) => [comment.short_id, comment]),
  );
  const total = story.comments.length + 1;
  const entries = [storyLines(story, `1/${total}`)];
  for (const [index, comment] of story.comments.entries()) {
    const parent =
      comment.parent_comment === null
        ? undefined
        : authors.get(comment.parent_comment);
    entries.push(
      commentLines(
        comment,
        `${index + 2}/${total}`,
        parent === undefined ? undefined : userOf(parent.commenting_user),
      ),
    );
  }
  return entries.join('\n\n---\n\n');
}

function storyLines(story: Story, position: string): string {
  const lines = [`## Post · ${position} — ${userOf(story.submitter_user)}`, ''];
  lines.push(`**${story.title}**`, '');
  if (story.url !== null) lines.push(`Link: ${story.url}`, '');
  const text = convertToMarkdown(story.description ?? '').trim();
  if (text) lines.push(text, '');
  if (story.tags.length > 0) lines.push(`Tags: ${story.tags.join(', ')}`, '');
  lines.push(
    `Score: ${story.score}`,
    `Source: ${LOBSTERS_ORIGIN}/s/${story.short_id}`,
    `Date: ${story.created_at}`,
  );
  return lines.join('\n');
}

function commentLines(
  comment: Comment,
  position: string,
  replyTo: string | undefined,
): string {
  const lines = [
    `## Reply · ${position} — ${userOf(comment.commenting_user)}`,
    '',
  ];
  if (replyTo !== undefined) lines.push(`Replying to ${replyTo}`, '');
  const text = convertToMarkdown(comment.comment ?? '').trim();
  if (text) lines.push(text, '');
  lines.push(
    `Score: ${comment.score}`,
    `Source: ${LOBSTERS_ORIGIN}/c/${comment.short_id}`,
    `Date: ${comment.created_at}`,
  );
  return lines.join('\n');
}

function userOf(user: string | null): string {
  return user === null ? '[deleted]' : `@${user}`;
}
