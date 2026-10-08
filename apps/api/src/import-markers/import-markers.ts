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
type QuoteDelimiter = '"' | "'";
type UnclosedQuoteLineEnds = Record<QuoteDelimiter, number | undefined>;
type MarkerContext = {
  source: string;
  mask: Uint8Array;
  markers: Array<Marker>;
};
type QuotedMarkerContext = {
  mask: Uint8Array;
  unclosedLineEnds: UnclosedQuoteLineEnds;
  markers: Array<Marker>;
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
  if (start === undefined || end === undefined) return undefined;
  return { start, end };
}

function isBareBoundary(source: string, offset: number): boolean {
  if (offset === 0) return true;
  const previous = source.at(offset - 1);
  return previous !== undefined && /[\s([{<"']/u.test(previous);
}
function isDelimitedBoundary(source: string, offset: number): boolean {
  let character = source.at(offset);
  if (character !== undefined && /\s/u.test(character)) return true;

  while (character !== undefined && TRAILING_PUNCTUATION.includes(character)) {
    offset += 1;
    character = source.at(offset);
  }
  return character === undefined || /\s/u.test(character);
}

function findTokenEnd(source: string, offset: number): number {
  while (source.at(offset) !== undefined) {
    if (/\s/u.test(source.charAt(offset))) break;
    offset += 1;
  }
  return offset;
}
function sliceBareTarget(source: string, start: number, end: number): string {
  let targetEnd = end;
  while (TRAILING_PUNCTUATION.includes(source.charAt(targetEnd - 1))) {
    targetEnd -= 1;
  }
  if (source.charAt(targetEnd - 1) === ':') targetEnd -= 1;
  return source.slice(start, targetEnd);
}

function collectQuotedMarker(
  source: string,
  offset: number,
  delimiter: QuoteDelimiter,
  context: QuotedMarkerContext,
): number {
  const lineEnd = context.unclosedLineEnds[delimiter];

  if (lineEnd !== undefined && offset < lineEnd) return offset + 2;

  let closingOffset = offset + 2;
  while (source.at(closingOffset) !== undefined) {
    const character = source.at(closingOffset);
    if (character === '\n' || character === '\r') {
      context.unclosedLineEnds[delimiter] = closingOffset;
      return offset + 2;
    }
    if (context.mask[closingOffset] === 1) return closingOffset;
    if (character === delimiter) {
      const end = closingOffset + 1;
      if (!isDelimitedBoundary(source, end)) {
        return findTokenEnd(source, end);
      }
      addMarker(
        context.markers,
        offset,
        source.slice(offset + 2, closingOffset),
      );
      return end;
    }
    closingOffset += 1;
  }

  context.unclosedLineEnds[delimiter] = source.length;
  return offset + 2;
}

function findInlineCodeMarker(
  value: string,
  range: SourceRange,
  position: NonNullable<Nodes['position']>,
  context: MarkerContext,
): void {
  const atOffset = range.start - 1;
  if (
    atOffset < 0 ||
    context.source.at(atOffset) !== '@' ||
    context.mask[atOffset] === 1 ||
    !isBareBoundary(context.source, atOffset) ||
    position.start.line !== position.end.line ||
    !isDelimitedBoundary(context.source, range.end)
  )
    return;
  addMarker(context.markers, atOffset, value);
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
  if (rawLink === undefined || rawLink.destination !== node.url) return;
  if (rawLink.title !== undefined && rawLink.title !== 'import') return;
  if (node.title !== null) {
    addMarker(markers, range.start, node.url);
    return;
  }

  const atOffset = range.start - 1;
  if (
    atOffset >= 0 &&
    source.at(atOffset) === '@' &&
    isBareBoundary(source, atOffset)
  ) {
    addMarker(markers, atOffset, node.url);
  }
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
  while (offset !== end) {
    if (!/\s/u.test(source.charAt(offset))) break;
    offset += 1;
  }
  return offset;
}

function findAngleDestinationEnd(
  source: string,
  offset: number,
  end: number,
): number | undefined {
  while (offset !== end) {
    if (source.at(offset) === '>') return offset;
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
  while (offset !== end) {
    const character = source.charAt(offset);
    if (/\s/u.test(character)) return offset;
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
  while (offset !== end) {
    const character = source.at(offset);
    if (character === delimiter) return offset;
    offset += 1;
  }
  return undefined;
}

function parseRawLinkTitle(
  source: string,
  range: SourceRange,
  offset: number,
  delimiter: string,
): string | undefined {
  const titleStart = offset + 1;
  const titleDelimiter = delimiter === '(' ? ')' : delimiter;
  const titleEnd = findLinkTitleEnd(
    source,
    titleStart,
    range.end,
    titleDelimiter,
  );
  if (titleEnd === undefined) return undefined;
  return source.slice(titleStart, titleEnd);
}

function parseRawLink(
  source: string,
  range: SourceRange,
  labelEnd: number,
): { destination: string; title: string | undefined } | undefined {
  if (
    source.at(labelEnd) !== ']' ||
    source.at(labelEnd + 1) !== '(' ||
    labelEnd + 2 > range.end
  )
    return undefined;
  let offset = skipLinkWhitespace(source, labelEnd + 2, range.end);
  let destinationStart = offset;
  let destinationEnd: number | undefined;
  if (source.at(offset) === '<') {
    destinationStart += 1;
    destinationEnd = findAngleDestinationEnd(
      source,
      destinationStart,
      range.end,
    );
    if (destinationEnd === undefined) return undefined;
    offset = destinationEnd + 1;
  } else {
    destinationEnd = findBareDestinationEnd(source, offset, range.end);
    if (destinationEnd === undefined) return undefined;
    offset = destinationEnd;
  }
  const destination = source.slice(destinationStart, destinationEnd);
  offset = skipLinkWhitespace(source, offset, range.end);
  const delimiter = source.at(offset);
  if (delimiter !== '"' && delimiter !== "'" && delimiter !== '(')
    return { destination, title: undefined };
  const title = parseRawLinkTitle(source, range, offset, delimiter);
  if (title === undefined) return undefined;
  return { destination, title };
}

function visitNode(node: Nodes, context: MarkerContext): void {
  const { source, mask, markers } = context;
  const range = nodeRange(node);
  const position = node.position;
  if (range && Object.hasOwn(EXCLUDED_NODE_TYPES, node.type)) {
    mask.fill(1, range.start, range.end);
  }

  if (range && position && node.type === 'inlineCode') {
    findInlineCodeMarker(node.value, range, position, context);
    return;
  }
  collectNodeMarkers(node, range, source, markers);
}

function appendChildren(node: Nodes, pending: Array<Nodes>): void {
  if ('children' in node) {
    for (let index = node.children.length; index; ) {
      index -= 1;
      pending.push(node.children[index]);
    }
  }
}

function collectNodes(root: Nodes, context: MarkerContext): void {
  const pending: Array<Nodes> = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) continue;
    visitNode(node, context);
    appendChildren(node, pending);
  }
}

function findReferenceRanges(source: string): Array<SourceRange> {
  const openingBrackets: Array<OpeningBracket> = [];
  const referenceRanges: Array<SourceRange> = [];
  let previousClosingStart: number | undefined;

  for (let offset = 0; source.at(offset) !== undefined; offset += 1) {
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
        end: offset,
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
  const delta = new Int32Array(source.length);
  for (const range of referenceRanges) {
    delta[range.start] += 1;
    delta[range.end] -= 1;
  }

  let active = 0;
  for (let offset = 0; offset !== source.length; offset += 1) {
    active += delta[offset];
    if (active > 0) mask[offset] = 1;
  }
}

function collectUnresolvedReferenceRanges(
  source: string,
  mask: Uint8Array,
): void {
  const referenceRanges = findReferenceRanges(source);
  if (referenceRanges.length) {
    maskReferenceRanges(source, mask, referenceRanges);
  }
}

function collectBareMarkers(
  source: string,
  mask: Uint8Array,
  markers: Array<Marker>,
): void {
  const quoteContext: QuotedMarkerContext = {
    mask,
    unclosedLineEnds: { '"': undefined, "'": undefined },
    markers,
  };

  for (let offset = 0; source.at(offset) !== undefined; ) {
    if (
      source.at(offset) !== '@' ||
      !isBareBoundary(source, offset) ||
      mask[offset] === 1 ||
      mask[offset + 1] === 1
    ) {
      offset += 1;
      continue;
    }

    const delimiter = source.at(offset + 1);
    if (delimiter === '"' || delimiter === "'") {
      offset = collectQuotedMarker(source, offset, delimiter, quoteContext);
      continue;
    }
    if (delimiter === '`') {
      offset += 2;
      continue;
    }

    const tokenStart = offset + 1;
    const tokenEnd = findTokenEnd(source, tokenStart);

    addMarker(markers, offset, sliceBareTarget(source, tokenStart, tokenEnd));
    offset = tokenEnd;
  }
}

export function importTargets(markdown: string): Array<string> {
  const tree = fromMarkdown(markdown);
  const mask = new Uint8Array(markdown.length);
  const markers: Array<Marker> = [];
  const markerContext: MarkerContext = {
    source: markdown,
    mask,
    markers,
  };

  collectUnresolvedReferenceRanges(markdown, mask);
  collectNodes(tree, markerContext);
  collectBareMarkers(markdown, mask, markers);

  markers.sort((left, right) => left.offset - right.offset);
  return [...new Set(markers.map((marker) => marker.target))];
}
