import { z } from 'zod';

import { primaryFailure, type WebAdapterOutcome } from '../contract';
import { fencedBlock } from './markdown';
import { TEXT, parseGithub } from './payload';
import {
  finishRendered,
  requestJson,
  type GithubReadOptions,
  type GithubRequestContext,
} from './request';
import type { GithubGistTarget } from './url';

const FILE_WIRE = z.object({
  filename: z.string(),
  language: z.string().nullish(),
  encoding: z.string().optional(),
  truncated: z.boolean().optional(),
  content: TEXT,
});
const GIST_WIRE = z.object({
  id: z.string(),
  html_url: z.string(),
  public: z.boolean(),
  description: TEXT,
  created_at: z.string(),
  updated_at: z.string(),
  owner: z.object({ login: z.string() }).nullish(),
  files: z.record(z.string(), FILE_WIRE),
  truncated: z.boolean().optional(),
});
type Gist = z.infer<typeof GIST_WIRE>;
type GistFile = z.infer<typeof FILE_WIRE>;

/** One `GET /gists/{id}` carries every file's text inline. */
export async function readGithubGist(
  target: GithubGistTarget,
  options: GithubReadOptions,
): Promise<WebAdapterOutcome> {
  const context: GithubRequestContext = { ...options, notes: [] };
  const primary = await requestJson(
    `${options.apiOrigin}/gists/${target.id}`,
    context,
  );
  if (primary.kind === 'failed') return primaryFailure(primary.failure);
  const gist = parseGithub(GIST_WIRE, primary.body);
  if (gist === undefined) return { kind: 'failed', failure: 'parse' };
  const files = shownFiles(gist, context.notes);
  return finishRendered(renderGist(gist, files), context);
}

/** A base64 file is binary and stays out; a file GitHub cut at 1 MB is shown
 *  as far as it arrived, and the gist's own 300-file cut is noted. */
function shownFiles(gist: Gist, notes: Array<string>): ReadonlyArray<GistFile> {
  const files = Object.values(gist.files);
  const shown: Array<GistFile> = [];
  for (const file of files) {
    if (file.encoding === 'base64') {
      notes.push(`${file.filename} omitted: binary`);
      continue;
    }
    if (file.truncated === true) {
      notes.push(`${file.filename} truncated: the first part only`);
    }
    shown.push(file);
  }
  if (gist.truncated === true) {
    notes.push(`files truncated: the first ${files.length} only`);
  }
  return shown;
}

function renderGist(gist: Gist, files: ReadonlyArray<GistFile>): string {
  const fields: Array<[string, string]> = [
    ['Description', gist.description.replaceAll(/\s+/gu, ' ').trim()],
    ['Owner', gist.owner?.login ?? 'anonymous'],
    ['Visibility', gist.public ? 'public' : 'secret'],
    ['Created', gist.created_at],
    ['Updated', gist.updated_at],
    ['URL', gist.html_url],
  ];
  const lines = [`# Gist ${gist.id}`, ''];
  for (const [label, value] of fields) {
    if (value) lines.push(`${label}: ${value}`);
  }
  for (const file of files) {
    // A fence's info string is one word; "Jupyter Notebook" has two.
    const info = file.language?.replaceAll(/\s+/gu, '-') ?? null;
    const content = file.content.replace(/\r?\n$/u, '');
    lines.push('', `## ${file.filename}`, '', fencedBlock(content, info));
  }
  return lines.join('\n');
}
