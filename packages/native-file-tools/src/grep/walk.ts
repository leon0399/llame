import ignore from "ignore";

import type { GrepEntry, GrepScope } from "./types";

/** The subset of the `ignore` manager the walker reads. */
export interface IgnoreRules {
  test(pathname: string): {
    readonly ignored: boolean;
    readonly unignored: boolean;
  };
}

/** One `.gitignore` layer, its rules relative to the directory that owns it. */
type IgnoreLayer = {
  readonly base: string;
  readonly rules: IgnoreRules;
};

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
}

/** No layer's verdict is void below this directory. */
const NOTHING_VOIDED: ReadonlySet<number> = new Set();

type WalkState = {
  readonly walk: GrepWalk;
  readonly layers: Array<IgnoreLayer>;
  /** Canonical identities of the directories on the current path (skill loops). */
  readonly ancestors: Set<string>;
  /** Layer indices a re-included directory put aside for its whole subtree. */
  readonly voided: ReadonlySet<number>;
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
    yield "";
    // The scope holds one entry: once the consumer examined it, the walk has
    // reached its end and a later stop names it as the resume point.
    walk.onReach("");
    return;
  }
  yield* walkDirectory(
    { walk, layers: [], ancestors: new Set(), voided: NOTHING_VOIDED },
    "",
  );
}

async function* walkDirectory(
  state: WalkState,
  rel: string,
): AsyncGenerator<string> {
  const { scope } = state.walk;
  const layer =
    scope.port.ignoreFile === undefined
      ? undefined
      : await loadIgnoreLayer(state, rel);
  if (layer !== undefined) state.layers.push(layer);
  // Encode each name once; a comparator that encodes allocates per comparison.
  const entries = (await scope.port.list(rel))
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
  if (layer !== undefined) state.layers.pop();
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
  if (scope.port.ignoreFile !== undefined && entry.name === ".gitignore")
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
  const voided = reIncludedLayers(state, rel);
  yield* walkDirectory({ ...state, voided }, rel);
  if (identity !== undefined) state.ancestors.delete(identity);
}

async function loadIgnoreLayer(
  state: WalkState,
  rel: string,
): Promise<IgnoreLayer | undefined> {
  const { port } = state.walk.scope;
  if (port.ignoreFile === undefined) return undefined;
  const text = await port.ignoreFile(rel);
  if (text === undefined) return undefined;
  return { base: rel, rules: ignore({ ignorecase: false }).add(text) };
}

/**
 * A layer's rules see the path relative to that layer's directory. Later
 * layers sit deeper, so their verdict — including a negation — wins. A layer a
 * re-included directory set aside takes no part in its subtree's verdicts.
 */
function isIgnored(state: WalkState, rel: string, directory: boolean): boolean {
  const pathname = directory ? `${rel}/` : rel;
  let ignored = false;
  for (const [index, layer] of state.layers.entries()) {
    if (state.voided.has(index)) continue;
    const result = layer.rules.test(pathRelativeTo(layer, pathname));
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}

/**
 * The layers a re-included directory voids for its subtree. The walker only
 * descends a directory a deeper layer re-included, so a layer that ignored it
 * must not decide the files inside it.
 */
function reIncludedLayers(state: WalkState, rel: string): ReadonlySet<number> {
  const pathname = `${rel}/`;
  let voided: Set<number> | undefined;
  for (const [index, layer] of state.layers.entries()) {
    if (state.voided.has(index)) continue;
    if (!layer.rules.test(pathRelativeTo(layer, pathname)).ignored) continue;
    if (!reIncludedByDeeperLayer(state.layers, index, pathname)) continue;
    voided ??= new Set(state.voided);
    voided.add(index);
  }
  return voided ?? state.voided;
}

/** Whether any layer below `index` re-includes the same directory. */
function reIncludedByDeeperLayer(
  layers: ReadonlyArray<IgnoreLayer>,
  index: number,
  pathname: string,
): boolean {
  for (let below = index + 1; below < layers.length; below += 1) {
    const layer = layers[below];
    if (layer.rules.test(pathRelativeTo(layer, pathname)).unignored)
      return true;
  }
  return false;
}

function pathRelativeTo(layer: IgnoreLayer, pathname: string): string {
  return layer.base.length === 0
    ? pathname
    : pathname.slice(layer.base.length + 1);
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
function compareRel(left: string, right: string): number {
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
