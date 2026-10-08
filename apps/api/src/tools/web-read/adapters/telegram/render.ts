import { parseHTML } from 'linkedom';

import { convertToMarkdown } from '../../pipeline';

export type TelegramRender =
  | { readonly content: string }
  | { readonly failure: 'empty' | 'parse' };

const ORIGIN = 'https://t.me';
const POST_ID = /^[1-9][0-9]{0,9}$/u;
const SCHEME = /^[a-z][a-z\d+.-]*:/iu;
const MESSAGE = '.tgme_widget_message[data-post]';
/** Wrappers that hold media items rather than being one: the album grid and
 *  the containers Telegram nests text and media in. */
const CONTAINERS = [
  'media_supported_cont',
  'tgme_widget_message_one_media',
  'tgme_widget_message_grouped_wrap',
  'tgme_widget_message_grouped',
  'tgme_widget_message_grouped_layer',
];
const STICKERS = [
  'tgme_widget_message_sticker_wrap',
  'tgme_widget_message_tgsticker_wrap',
  'tgme_widget_message_videosticker_wrap',
];
/** A media block the renderer has no note for: a contact, game, or invoice. */
const OTHER_MEDIA = /^tgme_widget_message_\w+_(?:wrap|player|poll)$/u;
/** The fallback block shown in place of a service message on the widget. */
const SERVICE_LABEL = 'Service message';

/** Post Widget HTML (`t.me/{name}/{id}?embed=1&mode=tme`) as one entry. */
export function renderWidgetPost(html: string): TelegramRender {
  const { document } = parseHTML(html);
  const message = document.querySelector(MESSAGE);
  if (message === null) {
    return document.querySelector('.tgme_widget_message_error') === null
      ? { failure: 'parse' }
      : { failure: 'empty' };
  }
  const bubble =
    message.querySelector('.tgme_widget_message_bubble') ?? message;
  if (isWidgetServiceMessage(bubble)) return { failure: 'empty' };
  return { content: renderPost(message, 1, 1) };
}

/** Web preview HTML (`t.me/s/{name}`) as the channel header, its cursor lines,
 *  and the page's posts newest first; `pageUrl` is the URL that was fetched. */
export function renderChannelPage(
  html: string,
  pageUrl: string,
): TelegramRender {
  const { document } = parseHTML(html);
  const info = document.querySelector('.tgme_channel_info');
  if (info === null) return { failure: 'parse' };
  const messages = [...document.querySelectorAll(MESSAGE)];
  // A header with no post and no "No posts found" placeholder is markup the
  // renderer no longer recognizes, not an empty page.
  if (
    messages.length === 0 &&
    document.querySelector('.tme_no_messages_found') === null
  ) {
    return { failure: 'parse' };
  }
  const posts = messages
    .filter((message) => !message.classList.contains('service_message'))
    .reverse();
  const entries = posts.map((message, index) =>
    renderPost(message, index + 1, posts.length),
  );
  const header = channelHeader(document, info, pageUrl);
  return { content: [header, ...entries].join('\n\n---\n\n') };
}

function channelHeader(
  document: Document,
  info: Element,
  pageUrl: string,
): string {
  const name = text(info, '.tgme_channel_info_header_username').replace(
    /^@/u,
    '',
  );
  const lines = [
    `# ${text(info, '.tgme_channel_info_header_title')} (@${name})`,
    '',
  ];
  const description = info.querySelector('.tgme_channel_info_description');
  const about = description === null ? '' : toMarkdown(description);
  if (about) lines.push(about, '');
  const subscribers = [
    ...info.querySelectorAll('.tgme_channel_info_counter'),
  ].find((counter) => text(counter, '.counter_type').startsWith('subscriber'));
  if (subscribers !== undefined) {
    lines.push(`Subscribers: ${text(subscribers, '.counter_value')}`);
  }
  lines.push(`URL: ${pageUrl}`);
  const older = cursor(document, 'prev', 'before');
  if (older) lines.push(`Older: ${ORIGIN}/s/${name}?before=${older}`);
  const newer = cursor(document, 'next', 'after');
  if (newer) lines.push(`Newer: ${ORIGIN}/s/${name}?after=${newer}`);
  return lines.join('\n');
}

/** The cursor value of the page's `<link rel>`, when it is a valid post id. */
function cursor(document: Document, rel: string, key: string): string {
  const href = document
    .querySelector(`link[rel="${rel}"]`)
    ?.getAttribute('href');
  const value = URL.parse(href ?? '', ORIGIN)?.searchParams.get(key) ?? '';
  return POST_ID.test(value) ? value : '';
}

function renderPost(message: Element, index: number, total: number): string {
  const post = message.getAttribute('data-post') ?? '';
  const bubble =
    message.querySelector('.tgme_widget_message_bubble') ?? message;
  const body = [...bubble.querySelectorAll('.tgme_widget_message_text')].find(
    (node) => node.closest('.tgme_widget_message_reply') === null,
  );
  const media = mediaNotes(bubble).map((note) => `> ${note}`);
  const link = linkLine(bubble);
  if (link) media.push(link);
  const sections = [
    `## Post · ${index}/${total} — ${authorLabel(bubble, post)}`,
    quoteLines(bubble).join('\n'),
    body === undefined ? '' : toMarkdown(body),
    media.join('\n'),
    metaLines(bubble, post).join('\n'),
  ];
  return sections.filter(Boolean).join('\n\n');
}

/** The channel as `{title} (@{name})`, or a group message's sender with the
 *  sender's `t.me` link when the markup carries one. */
function authorLabel(bubble: Element, post: string): string {
  const author = bubble.querySelector(':scope > .tgme_widget_message_author');
  const sender = author?.querySelector('.tgme_widget_message_author_name');
  if (sender) return withUrl(flatText(sender), sender);
  const title = text(bubble, '.tgme_widget_message_owner_name');
  return `${title} (@${post.split('/')[0] ?? ''})`;
}

function quoteLines(bubble: Element): Array<string> {
  const lines: Array<string> = [];
  const forward = bubble.querySelector(
    ':scope > .tgme_widget_message_forwarded_from',
  );
  const origin = forward?.querySelector(
    '.tgme_widget_message_forwarded_from_name',
  );
  if (origin) {
    lines.push(`> Forwarded from: ${withUrl(flatText(origin), origin)}`);
  }
  const reply = bubble.querySelector(':scope > .tgme_widget_message_reply');
  if (reply !== null) {
    const author = text(reply, '.tgme_widget_message_author_name');
    const snippet = text(reply, '.tgme_widget_message_text');
    const label = snippet ? `${author}: ${snippet}` : author;
    lines.push(`> Replying to ${withUrl(label, reply)}`);
  }
  return lines;
}

/** One note per media item, walking into album and media containers; the
 *  hidden "open Telegram" fallbacks are skipped. */
function mediaNotes(parent: Element): Array<string> {
  return [...parent.children].flatMap((child): Array<string> => {
    const note = mediaNote(child);
    if (note) return [note];
    const classes = [...child.classList];
    if (classes.includes('media_not_supported_cont')) return [];
    if (classes.some((name) => CONTAINERS.includes(name))) {
      return mediaNotes(child);
    }
    const unsupported =
      classes.includes('message_media_not_supported_wrap') ||
      classes.some((name) => OTHER_MEDIA.test(name));
    return unsupported ? ['[unsupported media]'] : [];
  });
}

function mediaNote(item: Element): string {
  const has = (name: string) => item.classList.contains(name);
  if (has('tgme_widget_message_photo_wrap')) return '[photo]';
  if (has('tgme_widget_message_video_player')) {
    return detailed('video', text(item, '.message_video_duration'));
  }
  if (has('tgme_widget_message_roundvideo_player')) {
    return detailed(
      'video message',
      text(item, '.tgme_widget_message_roundvideo_duration'),
    );
  }
  if (has('tgme_widget_message_voice_player')) {
    return detailed('voice', text(item, '.tgme_widget_message_voice_duration'));
  }
  if (STICKERS.some(has)) return '[sticker]';
  if (has('tgme_widget_message_location_wrap')) return '[location]';
  if (has('tgme_widget_message_poll')) {
    const question = text(item, '.tgme_widget_message_poll_question');
    return question ? `[poll: ${question}]` : '[poll]';
  }
  return has('tgme_widget_message_document_wrap') ? documentNote(item) : '';
}

/** An audio track is a document whose icon has the `audio` class; its extra
 *  line is the performer, where a plain document's is the file size. */
function documentNote(item: Element): string {
  const title = text(item, '.tgme_widget_message_document_title');
  const audio = item.querySelector('.tgme_widget_message_document_icon.audio');
  if (audio === null) return `[document: ${title}]`;
  const performer = text(item, '.tgme_widget_message_document_extra');
  return performer ? `[audio: ${title} — ${performer}]` : `[audio: ${title}]`;
}

function detailed(kind: string, detail: string): string {
  return detail ? `[${kind} ${detail}]` : `[${kind}]`;
}

function linkLine(bubble: Element): string {
  const card = bubble.querySelector('.tgme_widget_message_link_preview');
  if (card === null) return '';
  const site = text(card, '.link_preview_site_name');
  const title = text(card, '.link_preview_title');
  const description = text(card, '.link_preview_description');
  const summary = [title, description].filter(Boolean).join(': ');
  const label = [site, summary].filter(Boolean).join(' — ');
  return `> Link: ${withUrl(label, card)}`;
}

function metaLines(bubble: Element, post: string): Array<string> {
  const lines: Array<string> = [];
  const signature = text(bubble, '.tgme_widget_message_from_author');
  if (signature) lines.push(`Signed: ${signature}`);
  const views = text(bubble, '.tgme_widget_message_views');
  if (views) lines.push(`Views: ${views}`);
  const reactions = [...bubble.querySelectorAll('.tgme_reaction')].map(
    (reaction) => `${reactionLabel(reaction)} ${ownText(reaction)}`,
  );
  if (reactions.length > 0) lines.push(`Reactions: ${reactions.join(', ')}`);
  const meta = bubble.querySelector('.tgme_widget_message_meta');
  if (meta !== null && /\bedited\b/u.test(ownText(meta))) lines.push('Edited');
  lines.push(`Source: ${ORIGIN}/${post}`);
  const date = bubble
    .querySelector('.tgme_widget_message_date time[datetime]')
    ?.getAttribute('datetime');
  if (date) lines.push(`Date: ${date}`);
  return lines;
}

/** A standard emoji as itself, a custom emoji without a Unicode fallback as
 *  `custom`, and a paid reaction as a star. */
function reactionLabel(reaction: Element): string {
  if (reaction.classList.contains('tgme_reaction_paid')) return '⭐';
  const emoji = text(reaction, 'i.emoji, tg-emoji');
  return emoji || 'custom';
}

/** The widget shows a service message as a bubble-level fallback block
 *  labelled "Service message"; `/s/` marks it with a class instead. */
function isWidgetServiceMessage(bubble: Element): boolean {
  return [...bubble.children].some(
    (child) =>
      child.classList.contains('message_media_not_supported_wrap') &&
      !child.classList.contains('media_not_supported_cont') &&
      text(child, '.message_media_not_supported_label') === SERVICE_LABEL,
  );
}

/** Post or description HTML as Markdown: emoji as bare text, spoilers
 *  unwrapped, `/s/` hashtag search links as plain text, and other relative
 *  links resolved on `https://t.me`. */
function toMarkdown(node: Element): string {
  for (const emoji of node.querySelectorAll('tg-emoji, i.emoji')) {
    emoji.replaceWith(emoji.textContent ?? '');
  }
  for (const spoiler of node.querySelectorAll('tg-spoiler')) {
    spoiler.replaceWith(...spoiler.childNodes);
  }
  for (const anchor of node.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith('?q=')) anchor.replaceWith(anchor.textContent ?? '');
    else anchor.setAttribute('href', absolute(href));
  }
  return convertToMarkdown(node.innerHTML).trim();
}

/** `label (url)` with the element's `href` made absolute, the URL alone when
 *  there is no label, or the label alone when there is no `href`. */
function withUrl(label: string, node: Element): string {
  const href = node.getAttribute('href');
  if (!href) return label;
  return label ? `${label} (${absolute(href)})` : absolute(href);
}

function absolute(href: string): string {
  if (SCHEME.test(href)) return href;
  return URL.parse(href, ORIGIN)?.href ?? href;
}

/** Whitespace-collapsed text of the first match, with line breaks as spaces. */
function text(parent: Element, selector: string): string {
  const node = parent.querySelector(selector);
  return node === null ? '' : flatText(node);
}

function flatText(node: Element): string {
  for (const br of node.querySelectorAll('br')) br.replaceWith(' ');
  return (node.textContent ?? '').replaceAll(/\s+/gu, ' ').trim();
}

/** The element's own text nodes, without its children's text. */
function ownText(node: Element): string {
  return [...node.childNodes]
    .flatMap((child) =>
      child.nodeType === node.TEXT_NODE ? [child.textContent ?? ''] : [],
    )
    .join('')
    .replaceAll(/\s+/gu, ' ')
    .trim();
}
