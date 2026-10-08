import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Nodes } from 'mdast';

type SourceRange = {
  start: number;
  end: number;
};
type OpeningBracket = {
  start: number;
  referenceStart: number | undefined;
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

function skipLinkWhitespace(
  source: string,
  offset: number,
  end: number,
): number {
  while (offset < end && /\s/u.test(source.at(offset) ?? '')) {
    offset += 1;
  }
  return offset;
}

function findAngleDestinationEnd(
  source: string,
  offset: number,
  end: number,
): number | undefined {
  while (offset < end) {
    const character = source.at(offset);
    if (character === '\\') {
      offset += 2;
      continue;
    }
    if (character === '>') return offset;
    offset += 1;
  }
  return undefined;
}

function findBareDestinationEnd(
  source: string,
  offset: number,
  end: number,
): number | undefined {
  let parentheses = 0;
  while (offset < end) {
    const character = source.at(offset);
    if (character === '\\') {
      offset += 2;
      continue;
    }
    if (/\s/u.test(character ?? '')) {
      return parentheses === 0 ? offset : undefined;
    }
    if (character === '(') {
      parentheses += 1;
      offset += 1;
      continue;
    }
    if (character !== ')') {
      offset += 1;
      continue;
    }
    if (parentheses === 0) return offset;
    parentheses -= 1;
    offset += 1;
  }
  return undefined;
}

function findLinkTitleEnd(
  source: string,
  offset: number,
  end: number,
  delimiter: string,
): number | undefined {
  while (offset < end) {
    const character = source.at(offset);
    if (character === '\\') {
      offset += 2;
      continue;
    }
    if (character === delimiter) return offset;
    offset += 1;
  }
  return undefined;
}

function parseRawLink(
  source: string,
  range: SourceRange,
  labelEnd: number,
): { destination: string; title: string | undefined } | undefined {
  const labelClose = source.indexOf('](', labelEnd);
  if (labelClose < 0 || labelClose + 2 > range.end) return undefined;

  let offset = skipLinkWhitespace(source, labelClose + 2, range.end);
  let destinationStart = offset;
  let destinationEnd: number | undefined;
  if (source.at(offset) === '<') {
    destinationStart += 1;
    destinationEnd = findAngleDestinationEnd(source, offset + 1, range.end);
    if (destinationEnd === undefined) return undefined;
    offset = destinationEnd + 1;
  } else {
    destinationEnd = findBareDestinationEnd(source, offset, range.end);
    if (destinationEnd === undefined) return undefined;
    offset = destinationEnd;
  }
  const destination = source.slice(destinationStart, destinationEnd);
  offset = skipLinkWhitespace(source, offset, range.end);
  let title: string | undefined;
  const delimiter = source.at(offset);
  if (delimiter === '"' || delimiter === "'" || delimiter === '(') {
    const titleStart = offset + 1;
    const titleDelimiter = delimiter === '(' ? ')' : delimiter;
    const titleEnd = findLinkTitleEnd(
      source,
      titleStart,
      range.end,
      titleDelimiter,
    );
    if (titleEnd === undefined) return undefined;
    title = source.slice(titleStart, titleEnd);
    offset = skipLinkWhitespace(source, titleEnd + 1, range.end);
  }
  if (source.at(offset) !== ')' || offset + 1 !== range.end) return undefined;
  return { destination, title };
}

function collectNodeMarkers(
  node: Nodes,
  range: SourceRange | undefined,
  source: string,
  markers: Array<Marker>,
): void {
  if (range === undefined || node.type !== 'link') return;
  const labelEnd =
    node.children.at(-1)?.position?.end.offset ?? range.start + 1;
  const rawLink = parseRawLink(source, range, labelEnd);
  if (
    rawLink === undefined ||
    rawLink.destination !== node.url ||
    (node.title === null
      ? rawLink.title !== undefined
      : rawLink.title !== node.title)
  )
    return;
  if (rawLink.title !== undefined && rawLink.title !== 'import') return;
  if (node.title !== null) {
    addMarker(markers, range.start, node.url);
    return;
  }
  if (source[range.start] !== '[') return;

  const atOffset = range.start - 1;
  if (
    atOffset >= 0 &&
    source.at(atOffset) === '@' &&
    isBareBoundary(source, atOffset)
  ) {
    addMarker(markers, atOffset, node.url);
  }
}

function visitNode(
  node: Nodes,
  source: string,
  mask: Uint8Array,
  markers: Array<Marker>,
): void {
  const range = nodeRange(node);
  if (range && Object.hasOwn(EXCLUDED_NODE_TYPES, node.type)) {
    mask.fill(1, range.start, range.end);
  }

  collectNodeMarkers(node, range, source, markers);
}

function appendChildren(node: Nodes, pending: Array<Nodes>): void {
  if ('children' in node) {
    for (let index = node.children.length; index > 0; index -= 1) {
      pending.push(node.children[index - 1]);
    }
  }
}

function collectNodes(
  root: Nodes,
  source: string,
  mask: Uint8Array,
  markers: Array<Marker>,
): void {
  const pending: Array<Nodes> = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) continue;
    visitNode(node, source, mask, markers);
    appendChildren(node, pending);
  }
}

function findReferenceRanges(source: string): Array<SourceRange> {
  const openingBrackets: Array<OpeningBracket> = [];
  const referenceRanges: Array<SourceRange> = [];
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
      referenceRanges.push({
        start: opening.referenceStart,
        end: offset + 1,
      });
    }
    previousClosingStart = opening.start;
  }

  return referenceRanges;
}

function maskReferenceRanges(
  source: string,
  mask: Uint8Array,
  referenceRanges: Array<SourceRange>,
): void {
  if (referenceRanges.length === 0) return;
  const delta = new Int32Array(source.length + 1);
  for (const range of referenceRanges) {
    delta[range.start] += 1;
    delta[range.end] -= 1;
  }

  let active = 0;
  for (let offset = 0; offset < source.length; offset += 1) {
    active += delta[offset];
    if (active > 0) mask[offset] = 1;
  }
}

function collectUnresolvedReferenceRanges(
  source: string,
  mask: Uint8Array,
): void {
  maskReferenceRanges(source, mask, findReferenceRanges(source));
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
