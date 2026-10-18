import type { LinkedInWebAdapterConfig } from '../../../../instance-config/llame-config';
import type { WebRequestInit } from '../../http-client';
import {
  primaryFailure,
  type WebAdapter,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from '../contract';
import { renderLinkedIn } from './render';

const HTML: WebRequestInit = { accept: 'text/html' };
/** `www`, the apex, and a country host such as `es.linkedin.com`. */
const HOST = /^(?:www\.linkedin\.com|linkedin\.com|[a-z]{2}\.linkedin\.com)$/u;
const PROFILE_PATH = /^\/in\/([^/]+)\/?$/u;
const POST_PATH = /^\/posts\/([^/]+)\/?$/u;
const UPDATE_PATH =
  /^\/feed\/update\/urn:li:(?:activity|ugcPost|share):\d{8,}\/?$/u;
/** A public vanity name: 3–100 letters, numbers, and hyphens. */
const VANITY = /^[\p{L}\p{N}][\p{L}\p{N}-]{2,99}$/u;
/** `{author}_{slug}-{activity|ugcPost|share}-{id}[-{token}]`. */
const POST_SLUG =
  /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,240}-(?:activity|ugcPost|share)-\d{8,}(?:-[\p{L}\p{N}_-]{1,24})?$/u;

export type LinkedInPage =
  | { readonly kind: 'profile'; readonly vanity: string }
  | { readonly kind: 'post' };

/** Claims a public profile or post URL. Matching performs no I/O. */
export function parseLinkedInUrl(source: URL): LinkedInPage | undefined {
  if (
    source.protocol !== 'https:' ||
    source.port !== '' ||
    !HOST.test(source.hostname)
  ) {
    return undefined;
  }
  const path = decodedPath(source.pathname);
  if (path === undefined) return undefined;
  return profilePage(path) ?? postPage(path);
}

/** Creates the native LinkedIn adapter. */
export function createLinkedInAdapter(
  config: LinkedInWebAdapterConfig,
): WebAdapter {
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseLinkedInUrl(source) !== undefined,
    read: (source, io) => readLinkedIn(source, io),
  };
}

async function readLinkedIn(
  source: URL,
  io: WebAdapterIo,
): Promise<WebAdapterOutcome> {
  const page = parseLinkedInUrl(source);
  if (page === undefined) return { kind: 'failed', failure: 'parse' };
  const pageUrl = requestHref(source);
  const fetched = await io.fetch(pageUrl, HTML);
  if ('type' in fetched) return primaryFailure(fetched);
  // A 999 authwall never reaches here. A login or authwall redirect does.
  if (!acceptedLinkedInPage(fetched.finalUrl)) {
    return { kind: 'failed', failure: 'status' };
  }
  const rendered = renderLinkedIn(fetched.body, page, pageUrl);
  if ('failure' in rendered) {
    return { kind: 'failed', failure: rendered.failure };
  }
  return {
    kind: 'rendered',
    content: rendered.content,
    mediaType: 'text/markdown',
    notes: [],
  };
}

function requestHref(source: URL): string {
  const url = new URL(source.href);
  url.search = '';
  url.hash = '';
  return url.href;
}

function decodedPath(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
}

function profilePage(path: string): LinkedInPage | undefined {
  const vanity = PROFILE_PATH.exec(path)?.[1];
  if (vanity === undefined || !VANITY.test(vanity)) return undefined;
  return { kind: 'profile', vanity };
}

function postPage(path: string): LinkedInPage | undefined {
  const slug = POST_PATH.exec(path)?.[1];
  if (slug !== undefined && POST_SLUG.test(slug)) return { kind: 'post' };
  return UPDATE_PATH.test(path) ? { kind: 'post' } : undefined;
}

function acceptedLinkedInPage(finalUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(finalUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || !HOST.test(url.hostname)) return false;
  const path = url.pathname;
  if (path === '/authwall' || path.startsWith('/authwall/')) return false;
  if (path === '/login' || path.startsWith('/login/')) return false;
  if (path === '/uas' || path.startsWith('/uas/')) return false;
  return true;
}
