import { z } from 'zod';

import { primaryFailure, type WebAdapterOutcome } from '../contract';
import { formatItemBody } from './document';
import { NULLABLE, USER, parseGithub } from './payload';
import {
  finishRendered,
  repoPath,
  requestJson,
  type GithubReadOptions,
  type GithubRequestContext,
} from './request';
import type { GithubReleaseListTarget, GithubReleaseTarget } from './url';

/** The releases list endpoint's default page, which is all `/releases` reads. */
const RELEASE_PAGE_SIZE = 30;

const RELEASE_ENTRY_WIRE = z.object({
  tag_name: z.string(),
  name: NULLABLE,
  html_url: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: NULLABLE,
  created_at: z.string(),
});
const RELEASE_WIRE = RELEASE_ENTRY_WIRE.extend({
  author: USER,
  body: NULLABLE,
  assets: z.array(
    z.object({
      name: z.string(),
      size: z.number().int().nonnegative(),
      browser_download_url: z.string(),
    }),
  ),
});
type Release = z.infer<typeof RELEASE_WIRE>;
type ReleaseEntry = z.infer<typeof RELEASE_ENTRY_WIRE>;

/** One request reads a release by tag, the latest one, or the newest page. */
export async function readGithubRelease(
  target: GithubReleaseTarget | GithubReleaseListTarget,
  options: GithubReadOptions,
): Promise<WebAdapterOutcome> {
  const context: GithubRequestContext = { ...options, notes: [] };
  const primary = await requestJson(
    `${options.apiOrigin}${releasePath(target)}`,
    context,
  );
  if (primary.kind === 'failed') return primaryFailure(primary.failure);
  return target.kind === 'release-list'
    ? readList(target, primary.body, context)
    : readOne(primary.body, context);
}

function releasePath(
  target: GithubReleaseTarget | GithubReleaseListTarget,
): string {
  const base = `${repoPath(target)}/releases`;
  switch (target.kind) {
    case 'release':
      // Each component is encoded and the slashes kept, as GitHub spells a
      // scoped tag's own link.
      return `${base}/tags/${target.tag.split('/').map(encodeURIComponent).join('/')}`;
    case 'latest-release':
      return `${base}/latest`;
    case 'release-list':
      return `${base}?per_page=${RELEASE_PAGE_SIZE}`;
  }
}

function readOne(
  body: string,
  context: GithubRequestContext,
): WebAdapterOutcome {
  const release = parseGithub(RELEASE_WIRE, body);
  if (release === undefined) return { kind: 'failed', failure: 'parse' };
  return finishRendered(renderRelease(release), context);
}

function readList(
  target: GithubReleaseListTarget,
  body: string,
  context: GithubRequestContext,
): WebAdapterOutcome {
  const releases = parseGithub(z.array(RELEASE_ENTRY_WIRE), body);
  if (releases === undefined) return { kind: 'failed', failure: 'parse' };
  if (releases.length === RELEASE_PAGE_SIZE) {
    context.notes.push(
      `releases truncated: the first ${RELEASE_PAGE_SIZE} only`,
    );
  }
  return finishRendered(renderReleaseList(target, releases), context);
}

function renderRelease(release: Release): string {
  // GitHub names an unnamed release after its tag.
  const name = release.name === release.tag_name ? null : release.name;
  const fields: Array<[string, string | null]> = [
    ['Tag', release.tag_name],
    ['Author', release.author],
    ['Published', release.published_at],
    ['Prerelease', `${release.prerelease}`],
    ['Draft', `${release.draft}`],
    ['URL', release.html_url],
  ];
  const lines = [
    `# Release ${[release.tag_name, name].filter(Boolean).join(': ')}`,
    '',
  ];
  for (const [label, value] of fields) {
    if (value) lines.push(`${label}: ${value}`);
  }
  lines.push('', `## Assets (${release.assets.length})`);
  for (const asset of release.assets) {
    lines.push(
      `- ${asset.name} — ${asset.size.toLocaleString('en-US')} bytes — ${asset.browser_download_url}`,
    );
  }
  lines.push(
    '',
    '## Body',
    '',
    formatItemBody(release.body ?? '', 'No release notes provided.'),
  );
  return lines.join('\n');
}

function renderReleaseList(
  target: GithubReleaseListTarget,
  releases: ReadonlyArray<ReleaseEntry>,
): string {
  const lines = [`# Releases: ${target.owner}/${target.repo}`, ''];
  if (releases.length === 0) lines.push('No releases.');
  for (const release of releases) {
    const fields = [
      release.tag_name,
      release.name === release.tag_name ? null : release.name,
      release.published_at ?? release.created_at,
      release.prerelease ? 'prerelease' : null,
      release.draft ? 'draft' : null,
      release.html_url,
    ];
    lines.push(`- ${fields.filter(Boolean).join(' — ')}`);
  }
  return lines.join('\n');
}
