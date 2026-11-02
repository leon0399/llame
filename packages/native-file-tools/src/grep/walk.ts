import {
  compileIgnoreRules,
  decideIgnoreLayer,
  type CompiledIgnoreLayer,
} from "./ignore";
import { GREP_IGNORE_FILE_NAMES } from "./ignore-files";

import type { GrepEntry, GrepScope } from "./types";

/** One ignore file's rules, and where its paths start. */
type IgnoreLayer = {
  /** Directory inside the scope that holds the file; '' for the prefix. */
  readonly below: string;
  /** Path from the file's directory to the prefix, for a file above it. */
  readonly above: string;
  readonly layer: CompiledIgnoreLayer;
};

/** The ignore files a directory scope never searches. */
const IGNORE_FILE_NAMES = new Set<string>(GREP_IGNORE_FILE_NAMES);

/** What a resume point names: a file the page ended in, or a reached entry. */
export type GrepCursorKind = "passage" | "position";

/** One scope's walk: the port, the resume point, and the bound callbacks. */
export interface GrepWalk {
  readonly scope: GrepScope;
  /** Decoded path of the file the previous page ended at, relative to the prefix. */
  readonly cursorRel: string | undefined;
  /** Which entry the resume point names; undefined without a cursor. */
  readonly cursorKind: GrepCursorKind | undefined;
  /** Count one listed entry; false once the entry bound is reached. */
  readonly onEntry: () => boolean;
  /** Record one skipped link. */
  readonly onLink: () => void;
  /** Record one entry the walk finished handling, for a later position cursor. */
  readonly onReach: (rel: string) => void;
  /** Record one directory an ignore rule excluded. */
  readonly onIgnored: (rel: string) => void;
}

type WalkState = {
  readonly walk: GrepWalk;
  readonly layers: Array<IgnoreLayer>;
  /** Canonical identities of the directories on the current path (skill loops). */
  readonly ancestors: Set<string>;
};

/** Where an entry sits relative to the resume point. */
type CursorPosition = "before" | "ancestor" | "at" | "after";

/**
 * Yield every candidate file of one scope, relative to its prefix, in the
 * canonical order: depth-first, names in byte order, files in the position
 * their name sorts to. Entries before the resume point are listed but neither
 * opened nor counted, and their subtrees are not entered.
 */
export async function* walkGrepScope(walk: GrepWalk): AsyncGenerator<string> {
  if (walk.scope.singleFile) {
    // No resume point is recorded: `(scope, "")` restarts a scope, so a stop
    // after this file names the next scope, which the resumed call reaches.
    yield "";
    return;
  }
  yield* walkDirectory(
    { walk, layers: await ancestorLayers(walk), ancestors: new Set() },
    "",
  );
}

/** The layers above the prefix, shallowest first, so a deeper one wins. */
async function ancestorLayers(walk: GrepWalk): Promise<Array<IgnoreLayer>> {
  const { port } = walk.scope;
  if (port.ignoreAncestors === undefined) return [];
  const layers: Array<IgnoreLayer> = [];
  for (const file of await port.ignoreAncestors()) {
    const layer = compileIgnoreRules(file.text);
    if (layer.rules.length > 0)
      layers.push({ below: "", above: file.above, layer });
  }
  return layers;
}

async function* walkDirectory(
  state: WalkState,
  rel: string,
): AsyncGenerator<string> {
  const { scope } = state.walk;
  // One directory's listing and its ignore files read together: the listing is
  // the depth-first order the walk needs whole, so directories never overlap.
  const [texts, listed] = await Promise.all([
    scope.port.ignoreFiles === undefined
      ? Promise.resolve([])
      : scope.port.ignoreFiles(rel),
    scope.port.list(rel),
  ]);
  const depth = state.layers.length;
  for (const text of texts) {
    const layer = compileIgnoreRules(text);
    if (layer.rules.length > 0)
      state.layers.push({ below: rel, above: "", layer });
  }
  // Encode each name once; a comparator that encodes allocates per comparison.
  const entries = listed
    .map((entry) => ({ entry, key: Buffer.from(entry.name, "utf8") }))
    .sort((left, right) => Buffer.compare(left.key, right.key))
    .map(({ entry }) => entry);
  for (const entry of entries) {
    const childRel = rel.length === 0 ? entry.name : `${rel}/${entry.name}`;
    const position = cursorPosition(childRel, state.walk.cursorRel);
    const counted = countsEntry(state.walk.cursorKind, position);
    if (counted && !state.walk.onEntry()) break;
    if (entry.kind === "link") {
      if (scope.port.followsLinks) state.walk.onLink();
      if (counted) state.walk.onReach(childRel);
      continue;
    }
    if (entry.kind === "directory") {
      yield* walkDirectoryEntry(state, childRel, entry, position);
      continue;
    }
    if (isCandidate(state, entry, childRel, counted)) yield childRel;
    if (counted) state.walk.onReach(childRel);
  }
  state.layers.length = depth;
}

/**
 * A position cursor names an entry a stopped walk already handled, so entries
 * at it are listed but not counted. A passage cursor names the file a page
 * ended in, which a resume re-opens and counts.
 */
function countsEntry(
  kind: GrepCursorKind | undefined,
  position: CursorPosition,
): boolean {
  if (position === "after") return true;
  return position === "at" && kind === "passage";
}

/** Whether a listed entry is a file this scope would search. */
function isCandidate(
  state: WalkState,
  entry: GrepEntry,
  rel: string,
  counted: boolean,
): boolean {
  if (entry.kind !== "file" || !counted) return false;
  const { scope } = state.walk;
  if (scope.port.ignoreFiles !== undefined && IGNORE_FILE_NAMES.has(entry.name))
    return false;
  if (scope.glob !== undefined && !scope.glob.matchesFile(rel)) return false;
  return !isIgnored(state, rel, false);
}

async function* walkDirectoryEntry(
  state: WalkState,
  rel: string,
  entry: GrepEntry,
  position: CursorPosition,
): AsyncGenerator<string> {
  const { scope } = state.walk;
  const counted = countsEntry(state.walk.cursorKind, position);
  // A counted directory the walk does not descend still moves the resume
  // point: a later stop names it instead of the entry before it.
  const reach = (): void => {
    if (counted) state.walk.onReach(rel);
  };
  if (entry.name === ".git") {
    reach();
    return;
  }
  if (position === "before") return;
  if (isIgnored(state, rel, true)) {
    reach();
    // Only a counted exclusion is new: an entry the position cursor names was
    // reported by the previous page, and a directory on the way to the resume
    // point is before the start point.
    if (counted) state.walk.onIgnored(rel);
    return;
  }
  if (scope.glob !== undefined && !scope.glob.mayDescend(rel)) {
    reach();
    return;
  }
  const identity = entry.identity;
  if (identity !== undefined) {
    if (state.ancestors.has(identity)) {
      if (scope.port.followsLinks) state.walk.onLink();
      reach();
      return;
    }
    state.ancestors.add(identity);
  }
  // A directory counts as reached before it is descended: its own contents
  // overwrite this position as they are handled.
  if (position !== "ancestor") state.walk.onReach(rel);
  yield* walkDirectory(state, rel);
  if (identity !== undefined) state.ancestors.delete(identity);
}

/**
 * A rule decides an entry only when its own pattern matches that entry's path;
 * a deeper layer's deciding rule outranks a shallower one. The walk never tests
 * the scope directory or a directory above it.
 */
function isIgnored(state: WalkState, rel: string, directory: boolean): boolean {
  const pathname = directory ? `${rel}/` : rel;
  for (let index = state.layers.length - 1; index >= 0; index -= 1) {
    const layer = state.layers[index];
    const verdict = decideIgnoreLayer(
      layer.layer,
      pathRelativeTo(layer, pathname),
    );
    if (verdict !== undefined) return verdict;
  }
  return false;
}

/** The path a layer's rules see: relative to the file's own directory. */
function pathRelativeTo(layer: IgnoreLayer, pathname: string): string {
  if (layer.above.length > 0) return `${layer.above}${pathname}`;
  return layer.below.length === 0
    ? pathname
    : pathname.slice(layer.below.length + 1);
}

/**
 * An empty resume point names the start of the scope: every entry sorts after
 * it, so a resumed walk lists the scope again and counts every entry.
 */
function cursorPosition(
  rel: string,
  cursorRel: string | undefined,
): CursorPosition {
  if (cursorRel === undefined) return "after";
  const order = compareRel(rel, cursorRel);
  if (order === 0) return "at";
  if (order > 0) return "after";
  return cursorRel.startsWith(`${rel}/`) ? "ancestor" : "before";
}

/** Segment-wise byte order, which is the walk's canonical order. */
export function compareRel(left: string, right: string): number {
  const leftParts = left.split("/");
  const rightParts = right.split("/");
  const shared = Math.min(leftParts.length, rightParts.length);
  for (let index = 0; index < shared; index += 1) {
    const order = Buffer.compare(
      Buffer.from(leftParts[index], "utf8"),
      Buffer.from(rightParts[index], "utf8"),
    );
    if (order !== 0) return order;
  }
  return Math.sign(leftParts.length - rightParts.length);
}
