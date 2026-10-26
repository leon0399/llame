import { parseHTML } from 'linkedom';
import { z } from 'zod';

import type { LinkedInPage } from './adapter';

type LinkedInRender =
  | { readonly content: string }
  | { readonly failure: 'parse' };

const PERSON = z.object({
  '@type': z.literal('Person'),
  name: z.string(),
  url: z.string().nullish(),
  description: z.string().nullish(),
  jobTitle: z.unknown().nullish(),
  address: z.unknown().nullish(),
  worksFor: z.unknown().nullish(),
  alumniOf: z.unknown().nullish(),
});
const ADDRESS = z.object({
  addressLocality: z.string().nullish(),
});
const ORG = z.object({
  '@type': z.string().nullish(),
  name: z.string().nullish(),
  url: z.string().nullish(),
  location: z.string().nullish(),
  member: z.unknown().nullish(),
});
const MEMBER = z.object({
  description: z.string().nullish(),
  startDate: z.union([z.string(), z.number()]).nullish(),
  endDate: z.union([z.string(), z.number()]).nullish(),
});
const POSTING = z.object({
  '@type': z.enum(['SocialMediaPosting', 'DiscussionForumPosting']),
  '@id': z.string().nullish(),
  url: z.string().nullish(),
  datePublished: z.string().nullish(),
  articleBody: z.string().nullish(),
  text: z.string().nullish(),
  commentCount: z.number().nullish(),
  author: z.unknown().nullish(),
  image: z.unknown().nullish(),
  interactionStatistic: z.unknown().nullish(),
});
const AUTHOR = z.object({
  name: z.string().nullish(),
  url: z.string().nullish(),
});
const IMAGE = z.object({
  url: z.string().nullish(),
  contentUrl: z.string().nullish(),
  caption: z.string().nullish(),
  description: z.string().nullish(),
});
const STAT = z.object({
  interactionType: z.string().nullish(),
  userInteractionCount: z.number().nullish(),
});
const GRAPH = z.object({ '@graph': z.array(z.unknown()) });

type Person = z.infer<typeof PERSON>;
type Org = z.infer<typeof ORG>;
type Posting = z.infer<typeof POSTING>;
type Author = z.infer<typeof AUTHOR>;
type Role = {
  readonly summary: string;
  readonly line: string;
  readonly detail?: string;
  readonly current: boolean;
};
type Alumni = {
  readonly past: Array<Org>;
  readonly education: Array<Org>;
};

const HTTPS_URL = /^https:\/\/[^\s)]+$/u;
const HASHTAG = /(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu;
/** LinkedIn replaces each withheld word with asterisks of the same length. */
const MASKED_WORD = /^(?:\*+|undefined)$/u;

/** Renders a public profile or post from the page's JSON-LD. */
export function renderLinkedIn(
  html: string,
  page: LinkedInPage,
  pageUrl: string,
): LinkedInRender {
  const nodes = jsonLdNodes(html);
  return page.kind === 'profile'
    ? renderProfile(nodes, ogTitle(html), pageUrl)
    : renderPost(nodes, pageUrl);
}

function jsonLdNodes(html: string): Array<unknown> {
  const { document } = parseHTML(html);
  const nodes: Array<unknown> = [];
  for (const script of document.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    const text = script.textContent?.trim() ?? '';
    if (text === '') continue;
    try {
      for (const node of topLevel(JSON.parse(text))) nodes.push(node);
    } catch {
      continue;
    }
  }
  return nodes;
}

function topLevel(value: unknown): Array<unknown> {
  const listed = z.array(z.unknown()).safeParse(value);
  if (listed.success) return flatten(listed.data);
  const graph = GRAPH.safeParse(value);
  if (graph.success) return flatten(graph.data['@graph']);
  return [value];
}

function flatten(nodes: Array<unknown>): Array<unknown> {
  const flat: Array<unknown> = [];
  for (const node of nodes) {
    for (const item of topLevel(node)) flat.push(item);
  }
  return flat;
}

function ogTitle(html: string): string | undefined {
  const { document } = parseHTML(html);
  const content = document
    .querySelector('meta[property="og:title"]')
    ?.getAttribute('content');
  return content === null || content === undefined ? undefined : content;
}

function renderProfile(
  nodes: Array<unknown>,
  title: string | undefined,
  pageUrl: string,
): LinkedInRender {
  const person = firstWhere(nodes, PERSON);
  if (person === undefined) return { failure: 'parse' };
  const name = publicText(person.name);
  if (name === undefined) return { failure: 'parse' };
  const alumni = splitAlumni(itemsOf(person.alumniOf));
  const experience = experienceOf(person, alumni.past);
  const lines = [`# ${name}`, ''];
  pushField(lines, 'Headline', headlineOf(title, name));
  pushField(lines, 'Location', localityOf(person.address));
  pushField(lines, 'Current', currentLine(experience, person));
  pushField(lines, 'About', publicText(person.description));
  pushField(lines, 'URL', httpsUrl(person.url) ?? pageUrl);
  appendRoles(lines, 'Experience', experience);
  appendRoles(lines, 'Education', rolesFor(alumni.education, [], false));
  return { content: lines.join('\n') };
}

function renderPost(nodes: Array<unknown>, pageUrl: string): LinkedInRender {
  const post = firstWhere(nodes, POSTING);
  if (post === undefined) return { failure: 'parse' };
  const author = authorOf(post.author);
  const name = publicText(author?.name);
  const body = publicBody(post.articleBody) ?? publicBody(post.text);
  const lines = [`# ${name ?? 'LinkedIn post'}`, ''];
  pushField(lines, 'Author', authorLabel(author));
  pushField(lines, 'Date', publishedOf(post.datePublished));
  pushCount(lines, 'Reactions', reactionsOf(post));
  pushCount(lines, 'Comments', commentsOf(post));
  pushField(lines, 'Hashtags', hashtagLine(body));
  pushField(lines, 'URL', postUrl(post, pageUrl));
  if (body !== undefined) lines.push('', body);
  appendImages(lines, itemsOf(post.image));
  return { content: lines.join('\n') };
}

function firstWhere<Parsed>(
  nodes: Array<unknown>,
  schema: z.ZodType<Parsed>,
): Parsed | undefined {
  for (const node of nodes) {
    const parsed = schema.safeParse(node);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

function authorOf(value: unknown): Author | undefined {
  const parsed = AUTHOR.safeParse(value);
  return parsed.data;
}

function authorLabel(author: Author | undefined): string | undefined {
  const name = publicText(author?.name);
  if (name === undefined) return undefined;
  const url = httpsUrl(author?.url);
  return url === undefined ? name : `${name} (${url})`;
}

function headlineOf(
  title: string | undefined,
  name: string,
): string | undefined {
  if (title === undefined) return undefined;
  let body = title.trim();
  const suffix = ' | LinkedIn';
  if (body.endsWith(suffix)) body = body.slice(0, -suffix.length).trim();
  const prefix = `${name} - `;
  if (!body.startsWith(prefix)) return undefined;
  return publicText(body.slice(prefix.length));
}

function localityOf(value: unknown): string | undefined {
  const parsed = ADDRESS.safeParse(value);
  const address = parsed.data;
  if (address === undefined) return undefined;
  return publicText(address.addressLocality);
}

function currentLine(roles: Array<Role>, person: Person): string | undefined {
  const summaries: Array<string> = [];
  for (const role of roles) {
    if (role.current) summaries.push(role.summary);
  }
  if (summaries.length > 0) return summaries.join('; ');
  const titles = visibleTitles(titleList(person.jobTitle));
  return titles.length === 0 ? undefined : titles.join('; ');
}

function experienceOf(person: Person, past: Array<Org>): Array<Role> {
  return [
    ...rolesFor(
      orgsOf(itemsOf(person.worksFor)),
      titleList(person.jobTitle),
      true,
    ),
    ...rolesFor(past, [], false),
  ];
}

function splitAlumni(items: Array<unknown>): Alumni {
  const past: Array<Org> = [];
  const education: Array<Org> = [];
  for (const org of orgsOf(items)) {
    if (org['@type'] === 'EducationalOrganization') education.push(org);
    else past.push(org);
  }
  return { past, education };
}

function rolesFor(
  orgs: Array<Org>,
  titles: Array<string | undefined>,
  current: boolean,
): Array<Role> {
  const roles: Array<Role> = [];
  for (const [index, org] of orgs.entries()) {
    const role = roleOf(org, titles[index], current);
    if (role !== undefined) roles.push(role);
  }
  return roles;
}

function roleOf(
  org: Org,
  title: string | undefined,
  current: boolean,
): Role | undefined {
  const name = publicText(org.name);
  if (name === undefined) return undefined;
  const role = publicText(title);
  const summary = role === undefined ? name : `${role} at ${name}`;
  const url = httpsUrl(org.url);
  const label = url === undefined ? summary : `${summary} (${url})`;
  const member = MEMBER.safeParse(org.member).data;
  const place = publicText(org.location);
  const when = datesOf(member?.startDate, member?.endDate, current);
  const parts = [label];
  if (place !== undefined) parts.push(place);
  if (when !== undefined) parts.push(when);
  const detail = publicText(member?.description);
  return {
    summary,
    line: `- ${parts.join(' · ')}`,
    ...(detail !== undefined && { detail }),
    current,
  };
}

function datesOf(
  start: string | number | null | undefined,
  end: string | number | null | undefined,
  current: boolean,
): string | undefined {
  const opened = dateText(start);
  const closed = dateText(end);
  if (opened !== undefined && closed !== undefined) {
    return `${opened} – ${closed}`;
  }
  if (opened !== undefined && current) return `${opened} – present`;
  return opened ?? closed;
}

function dateText(
  value: string | number | null | undefined,
): string | undefined {
  const numeric = z.number().safeParse(value);
  if (numeric.success) return String(numeric.data);
  const text = z.string().safeParse(value);
  return publicText(text.data);
}

function itemsOf(value: unknown): Array<unknown> {
  const listed = z.array(z.unknown()).safeParse(value);
  return listed.success ? listed.data : [value];
}

function orgsOf(items: Array<unknown>): Array<Org> {
  const orgs: Array<Org> = [];
  for (const item of items) {
    const parsed = ORG.safeParse(item);
    if (parsed.success) orgs.push(parsed.data);
  }
  return orgs;
}

function titleList(value: unknown): Array<string | undefined> {
  const text = z.string().safeParse(value);
  if (text.success) return [text.data];
  const listed = z.array(z.unknown()).safeParse(value);
  const source = listed.success ? listed.data : [];
  const titles: Array<string | undefined> = [];
  for (const item of source) titles.push(z.string().safeParse(item).data);
  return titles;
}

function visibleTitles(titles: Array<string | undefined>): Array<string> {
  const visible: Array<string> = [];
  for (const title of titles) {
    const text = publicText(title);
    if (text !== undefined) visible.push(text);
  }
  return visible;
}

function reactionsOf(post: Posting): number | undefined {
  return interactionCount(itemsOf(post.interactionStatistic), 'LikeAction');
}

function commentsOf(post: Posting): number | undefined {
  const direct = counted(post.commentCount);
  if (direct !== undefined) return direct;
  return interactionCount(itemsOf(post.interactionStatistic), 'CommentAction');
}

function counted(value: number | null | undefined): number | undefined {
  if (value == null || value < 0) return undefined;
  return value;
}

function interactionCount(
  items: Array<unknown>,
  action: string,
): number | undefined {
  let total: number | undefined;
  for (const item of items) {
    const count = statCount(item, action);
    if (count === undefined) continue;
    total = (total ?? 0) + count;
  }
  return total;
}

function statCount(value: unknown, action: string): number | undefined {
  const parsed = STAT.safeParse(value);
  const type = parsed.data?.interactionType;
  const count = parsed.data?.userInteractionCount;
  if (type == null || !isSchemaAction(type, action)) return undefined;
  if (count == null || count < 0) return undefined;
  return count;
}

function isSchemaAction(type: string, action: string): boolean {
  return (
    type === `http://schema.org/${action}` ||
    type === `https://schema.org/${action}`
  );
}

function hashtagLine(body: string | undefined): string | undefined {
  if (body === undefined) return undefined;
  const seen = new Set<string>();
  const tags: Array<string> = [];
  for (const tag of body.match(HASHTAG) ?? []) {
    const key = tag.toLocaleLowerCase('en');
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags.length === 0 ? undefined : tags.join(', ');
}

function appendImages(lines: Array<string>, items: Array<unknown>): void {
  const blocks: Array<Array<string>> = [];
  for (const item of items) {
    const block = imageLines(item);
    if (block !== undefined) blocks.push(block);
  }
  if (blocks.length === 0) return;
  lines.push('', '## Media');
  for (const block of blocks) {
    for (const line of block) lines.push(line);
  }
}

function imageLines(value: unknown): Array<string> | undefined {
  const parsed = IMAGE.safeParse(value);
  const image = parsed.data;
  if (image === undefined) return undefined;
  const url = httpsUrl(image.url) ?? httpsUrl(image.contentUrl);
  if (url === undefined) return undefined;
  const caption = publicBody(image.caption) ?? publicBody(image.description);
  const lines = [`- ${url}`];
  if (caption === undefined) return lines;
  for (const line of caption.split('\n')) {
    lines.push(line.trim() === '' ? '' : `  ${line.trim()}`);
  }
  return lines;
}

function postUrl(post: Posting, pageUrl: string): string {
  return httpsUrl(post['@id']) ?? httpsUrl(post.url) ?? pageUrl;
}

function publishedOf(value: string | null | undefined): string | undefined {
  const text = publicText(value);
  if (text === undefined) return undefined;
  return Number.isFinite(Date.parse(text)) ? text : undefined;
}

function pushCount(
  lines: Array<string>,
  label: string,
  count: number | undefined,
): void {
  if (count !== undefined) lines.push(`${label}: ${String(count)}`);
}

function pushField(
  lines: Array<string>,
  label: string,
  value: string | undefined,
): void {
  if (value !== undefined) lines.push(`${label}: ${value}`);
}

function publicText(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const text = value.replaceAll(/\s+/gu, ' ').trim();
  return text === '' || isMasked(text) ? undefined : text;
}

function publicBody(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const text = value.trim();
  return text === '' || isMasked(text) ? undefined : text;
}

function isMasked(value: string): boolean {
  const words = value.trim().split(/\s+/u);
  return words.length > 0 && words.every((word) => MASKED_WORD.test(word));
}

function httpsUrl(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const text = value.trim();
  if (!HTTPS_URL.test(text)) return undefined;
  try {
    return new URL(text).protocol === 'https:' ? text : undefined;
  } catch {
    return undefined;
  }
}

function appendRoles(
  lines: Array<string>,
  heading: string,
  roles: Array<Role>,
): void {
  if (roles.length === 0) return;
  lines.push('', `## ${heading}`);
  for (const role of roles) {
    lines.push(role.line);
    if (role.detail !== undefined) lines.push(`  ${role.detail}`);
  }
}
