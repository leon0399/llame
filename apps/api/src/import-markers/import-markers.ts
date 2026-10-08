import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Nodes } from 'mdast';

type SourceRange = {
  start: number;
  end: number;
};

type Marker = {
  offset: number;
  target: string;
};

const EXCLUDED_NODE_TYPES = {
  code: true,
  inlineCode: true,
  html: true,
  link: true,
  image: true,
  imageReference: true,
  linkReference: true,
  definition: true,
} satisfies Partial<Record<Nodes['type'], true>>;

const TRAILING_PUNCTUATION = '.,;!?)]}>"\'';

function nodeRange(node: Nodes): SourceRange | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined || end <= start)
    return undefined;
  return { start, end };
}

function isBareBoundary(source: string, offset: number): boolean {
  if (offset === 0) return true;
  const previous = source.at(offset - 1);
  return previous !== undefined && /[\s([{<"']/u.test(previous);
}

function addMarker(
  markers: Array<Marker>,
  offset: number,
  target: string,
): void {
  if (target.length > 0) markers.push({ offset, target });
}

function collectNodes(
  node: Nodes,
  source: string,
  mask: Uint8Array,
  markers: Array<Marker>,
): void {
  const range = nodeRange(node);
  if (range && Object.hasOwn(EXCLUDED_NODE_TYPES, node.type)) {
    mask.fill(1, range.start, range.end);
  }

  if (range && node.type === 'link') {
    if (node.title === 'import') {
      addMarker(markers, range.start, node.url);
    } else if (node.title === null) {
      const atOffset = range.start - 1;
      if (
        atOffset >= 0 &&
        source.at(atOffset) === '@' &&
        isBareBoundary(source, atOffset)
      ) {
        addMarker(markers, atOffset, node.url);
      }
    }
  }

  if ('children' in node) {
    for (const child of node.children) {
      collectNodes(child, source, mask, markers);
    }
  }
}

function collectUnresolvedReferenceRanges(
  source: string,
  mask: Uint8Array,
): void {
  const openingBrackets: Array<{
    start: number;
    referenceStart: number | undefined;
  }> = [];
  let previousClosingStart: number | undefined;

  for (let offset = 0; offset < source.length; offset += 1) {
    const character = source.at(offset);
    if (character === '\\') {
      offset += 1;
      continue;
    }

    if (character === '[') {
      openingBrackets.push({
        start: offset,
        referenceStart:
          source.at(offset - 1) === ']' ? previousClosingStart : undefined,
      });
      continue;
    }

    if (character !== ']') continue;
    const opening = openingBrackets.pop();
    if (opening === undefined) {
      previousClosingStart = undefined;
      continue;
    }
    if (opening.referenceStart !== undefined) {
      mask.fill(1, opening.referenceStart, offset + 1);
    }
    previousClosingStart = opening.start;
  }
}

function collectBareMarkers(
  source: string,
  mask: Uint8Array,
  markers: Array<Marker>,
): void {
  for (let offset = 0; offset < source.length; ) {
    if (
      source.at(offset) !== '@' ||
      mask[offset] !== 0 ||
      !isBareBoundary(source, offset) ||
      mask[offset + 1] === 1
    ) {
      offset += 1;
      continue;
    }

    const tokenStart = offset + 1;
    let tokenEnd = tokenStart;
    while (tokenEnd < source.length) {
      const character = source.at(tokenEnd);
      if (character === undefined || /\s/u.test(character)) break;
      tokenEnd += 1;
    }

    let targetEnd = tokenEnd;
    while (
      targetEnd > tokenStart &&
      TRAILING_PUNCTUATION.includes(source.at(targetEnd - 1) ?? '')
    ) {
      targetEnd -= 1;
    }
    if (targetEnd > tokenStart && source.at(targetEnd - 1) === ':') {
      targetEnd -= 1;
    }
    if (targetEnd > tokenStart) {
      addMarker(markers, offset, source.slice(tokenStart, targetEnd));
    }
    offset = tokenEnd;
  }
}

export function importTargets(markdown: string): Array<string> {
  const tree = fromMarkdown(markdown);
  const mask = new Uint8Array(markdown.length);
  const markers: Array<Marker> = [];

  collectNodes(tree, markdown, mask, markers);
  collectUnresolvedReferenceRanges(markdown, mask);
  collectBareMarkers(markdown, mask, markers);

  markers.sort((left, right) => left.offset - right.offset);
  return [...new Set(markers.map((marker) => marker.target))];
}
