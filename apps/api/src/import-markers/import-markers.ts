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

const TRAILING_PUNCTUATION = /[.,;!?)\]}>"']+$/u;

function nodeRange(node: Nodes): SourceRange | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined || end <= start)
    return undefined;
  return { start, end };
}

function isBareBoundary(source: string, offset: number): boolean {
  if (offset === 0) return true;
  const previous = source[offset - 1];
  return (
    /\s/u.test(previous) ||
    previous === '(' ||
    previous === '[' ||
    previous === '{' ||
    previous === '<' ||
    previous === '"' ||
    previous === "'"
  );
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
  excludedRanges: Array<SourceRange>,
  markers: Array<Marker>,
): void {
  const range = nodeRange(node);
  if (range && Object.hasOwn(EXCLUDED_NODE_TYPES, node.type)) {
    excludedRanges.push(range);
  }

  if (range && node.type === 'link') {
    if (node.title === 'import') {
      addMarker(markers, range.start, node.url);
    } else if (node.title === null) {
      const atOffset = range.start - 1;
      if (
        atOffset >= 0 &&
        source[atOffset] === '@' &&
        isBareBoundary(source, atOffset)
      ) {
        addMarker(markers, atOffset, node.url);
      }
    }
  }

  if ('children' in node) {
    for (const child of node.children) {
      collectNodes(child, source, excludedRanges, markers);
    }
  }
}

function closingBracket(source: string, start: number): number {
  let nesting = 0;
  for (let offset = start; offset < source.length; offset += 1) {
    if (source[offset] === '\\') {
      offset += 1;
      continue;
    }
    if (source[offset] === '[') {
      nesting += 1;
    } else if (source[offset] === ']') {
      if (nesting === 0) return offset;
      nesting -= 1;
    }
  }
  return -1;
}

function collectUnresolvedReferenceRanges(
  source: string,
  excludedRanges: Array<SourceRange>,
): void {
  for (let offset = 0; offset < source.length; offset += 1) {
    if (source[offset] !== '[') continue;
    const labelEnd = closingBracket(source, offset + 1);
    if (labelEnd < 0) break;
    const referenceStart = labelEnd + 1;
    if (source[referenceStart] !== '[') {
      offset = labelEnd;
      continue;
    }
    const referenceEnd = closingBracket(source, referenceStart + 1);
    if (referenceEnd < 0) {
      offset = labelEnd;
      continue;
    }
    // Unresolved references remain a text node in mdast, but marker-shaped text
    // inside their source syntax is still link-reference content.
    excludedRanges.push({ start: offset, end: referenceEnd + 1 });
    offset = referenceEnd;
  }
}

function mergeRanges(ranges: Array<SourceRange>): Array<SourceRange> {
  ranges.sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );
  const merged: Array<SourceRange> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function bareTarget(source: string, offset: number): string {
  let end = offset + 1;
  while (end < source.length && !/\s/u.test(source[end])) end += 1;

  return source
    .slice(offset + 1, end)
    .replace(TRAILING_PUNCTUATION, '')
    .replace(/:$/u, '');
}

function collectBareMarkers(
  source: string,
  excludedRanges: Array<SourceRange>,
  markers: Array<Marker>,
): void {
  let rangeIndex = 0;
  for (let offset = 0; offset < source.length; ) {
    while (
      rangeIndex < excludedRanges.length &&
      excludedRanges[rangeIndex].end <= offset
    ) {
      rangeIndex += 1;
    }
    const range = excludedRanges[rangeIndex];
    if (range && offset >= range.start) {
      offset = range.end;
      continue;
    }

    if (source[offset] === '@' && isBareBoundary(source, offset)) {
      if (!range || range.start !== offset + 1) {
        addMarker(markers, offset, bareTarget(source, offset));
      }
    }
    offset += 1;
  }
}

export function importTargets(markdown: string): Array<string> {
  const tree = fromMarkdown(markdown);
  const excludedRanges: Array<SourceRange> = [];
  const markers: Array<Marker> = [];

  collectNodes(tree, markdown, excludedRanges, markers);
  collectUnresolvedReferenceRanges(markdown, excludedRanges);
  collectBareMarkers(markdown, mergeRanges(excludedRanges), markers);

  markers.sort((left, right) => left.offset - right.offset);
  const targets: Array<string> = [];
  const seen = new Set<string>();
  for (const marker of markers) {
    if (seen.has(marker.target)) continue;
    seen.add(marker.target);
    targets.push(marker.target);
  }
  return targets;
}
