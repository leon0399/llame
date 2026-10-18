import { z } from 'zod';

/** A node in Luma's ProseMirror description. Unknown attrs are ignored. */
export type MirrorMark = {
  readonly type: string;
  readonly attrs?: { readonly href?: string | null } | null;
};

export type MirrorNode = {
  readonly type: string;
  readonly text?: string | null;
  readonly attrs?: {
    readonly level?: number | null;
    readonly href?: string | null;
    readonly src?: string | null;
    readonly alt?: string | null;
  } | null;
  readonly marks?: ReadonlyArray<MirrorMark> | null;
  readonly content?: ReadonlyArray<MirrorNode> | null;
};

const MARK = z.object({
  type: z.string(),
  attrs: z.object({ href: z.string().nullish() }).nullish(),
});

/** Luma stores the event description as a ProseMirror document, not HTML. */
export const MIRROR: z.ZodType<MirrorNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    text: z.string().nullish(),
    attrs: z
      .object({
        level: z.number().nullish(),
        href: z.string().nullish(),
        src: z.string().nullish(),
        alt: z.string().nullish(),
      })
      .nullish(),
    marks: z.array(MARK).nullish(),
    content: z.array(MIRROR).nullish(),
  }),
);

const SAFE_URL = /^https?:\/\/[^\s)]+$/u;

/** The description as Markdown, or empty when Luma sent none. */
export function renderMirror(node: MirrorNode | null | undefined): string {
  if (node === null || node === undefined) return '';
  return renderBlocks(node.content ?? []).trim();
}

function renderBlocks(nodes: ReadonlyArray<MirrorNode>): string {
  const blocks: Array<string> = [];
  for (const node of nodes) {
    const block = renderBlock(node).trim();
    if (block !== '') blocks.push(block);
  }
  return blocks.join('\n\n');
}

function renderBlock(node: MirrorNode): string {
  switch (node.type) {
    case 'paragraph':
      return inlineText(node);
    case 'heading':
      return heading(node);
    case 'bullet_list':
      return renderList(node, false);
    case 'ordered_list':
      return renderList(node, true);
    case 'blockquote':
      return quote(renderBlocks(node.content ?? []));
    case 'code_block':
      return fence(inlineText(node));
    case 'horizontal_rule':
      return '---';
    case 'image':
      return image(node);
    default:
      return renderBlocks(node.content ?? []);
  }
}

function heading(node: MirrorNode): string {
  const text = inlineText(node);
  if (text === '') return '';
  return `${'#'.repeat(headingLevel(node.attrs?.level))} ${text}`;
}

function headingLevel(level: number | null | undefined): number {
  if (level === null || level === undefined || !Number.isInteger(level)) {
    return 1;
  }
  if (level < 1) return 1;
  return level > 6 ? 6 : level;
}

function inlineText(node: MirrorNode): string {
  return renderInline(node.content ?? []).trim();
}

function renderList(node: MirrorNode, ordered: boolean): string {
  const lines: Array<string> = [];
  let index = 0;
  for (const child of node.content ?? []) {
    if (child.type !== 'list_item') continue;
    index += 1;
    lines.push(renderItem(child, ordered ? `${index}.` : '-'));
  }
  return lines.join('\n');
}

function renderItem(item: MirrorNode, marker: string): string {
  const blocks = itemBlocks(item);
  const first = blocks[0];
  if (first === undefined) return marker;
  const pad = ' '.repeat(marker.length + 1);
  const lines = [`${marker} ${hang(first, pad)}`];
  for (const block of blocks.slice(1)) lines.push(prefixLines(block, pad));
  return lines.join('\n');
}

function itemBlocks(item: MirrorNode): Array<string> {
  const blocks: Array<string> = [];
  for (const child of item.content ?? []) {
    const block = renderBlock(child).trim();
    if (block !== '') blocks.push(block);
  }
  return blocks;
}

function hang(text: string, pad: string): string {
  const [first, ...rest] = text.split('\n');
  if (rest.length === 0) return first ?? '';
  return [first, prefixLines(rest.join('\n'), pad)].join('\n');
}

function quote(text: string): string {
  const body = text.trim();
  return body === '' ? '' : prefixLines(body, '> ');
}

function fence(text: string): string {
  return text === '' ? '' : `\`\`\`\n${text}\n\`\`\``;
}

function image(node: MirrorNode): string {
  const src = node.attrs?.src;
  if (src === null || src === undefined || !SAFE_URL.test(src)) return '';
  const alt = node.attrs?.alt;
  const label = alt === null || alt === undefined ? '' : escapeInline(alt);
  return `![${label}](${src})`;
}

function prefixLines(text: string, pad: string): string {
  return text
    .split('\n')
    .map((line) => (line.length === 0 ? line : pad + line))
    .join('\n');
}

function renderInline(nodes: ReadonlyArray<MirrorNode>): string {
  let text = '';
  for (const node of nodes) text += inlinePiece(node);
  return text;
}

function inlinePiece(node: MirrorNode): string {
  if (node.type === 'hard_break') return '  \n';
  if (node.type === 'text') {
    return applyMarks(node.text ?? '', node.marks ?? []);
  }
  return renderInline(node.content ?? []);
}

function applyMarks(text: string, marks: ReadonlyArray<MirrorMark>): string {
  const href = linkHref(marks);
  const body = hasMark(marks, 'code') ? codeSpan(text) : emphasis(text, marks);
  return href === undefined ? body : `[${body}](${href})`;
}

function codeSpan(text: string): string {
  return `\`${text.replaceAll('`', '\\`')}\``;
}

function emphasis(text: string, marks: ReadonlyArray<MirrorMark>): string {
  let out = escapeInline(text);
  if (hasMark(marks, 'bold')) out = `**${out}**`;
  if (hasMark(marks, 'italic')) out = `*${out}*`;
  if (hasMark(marks, 'strike')) out = `~~${out}~~`;
  return out;
}

function escapeInline(text: string): string {
  return text.replaceAll(/[\\`*_[\]~]/gu, (character) => `\\${character}`);
}

function hasMark(marks: ReadonlyArray<MirrorMark>, type: string): boolean {
  for (const mark of marks) {
    if (mark.type === type) return true;
  }
  return false;
}

function linkHref(marks: ReadonlyArray<MirrorMark>): string | undefined {
  for (const mark of marks) {
    if (mark.type !== 'link') continue;
    const href = mark.attrs?.href;
    if (href !== null && href !== undefined && SAFE_URL.test(href)) return href;
  }
  return undefined;
}
