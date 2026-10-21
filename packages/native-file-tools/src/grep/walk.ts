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

/** One scope's walk: the port, the resume point, and the bound callbacks. */
export interface GrepWalk {
  readonly scope: GrepScope;
  /** Decoded path of the file the previous page ended at, relative to the prefix. */
  readonly cursorRel: string | undefined;
  /** Count one listed entry; false once the entry bound is reached. */
  readonly onEntry: () => boolean;
  /** Record one skipped link. */
  readonly onLink: () => void;
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
    yield "";
    return;
  }
  yield* walkDirectory({ walk, layers: [], ancestors: new Set() }, "");
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
  const entries = [...(await scope.port.list(rel))].sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.name, "utf8"),
      Buffer.from(right.name, "utf8"),
    ),
  );
  for (const entry of entries) {
    const childRel = rel.length === 0 ? entry.name : `${rel}/${entry.name}`;
    const position = cursorPosition(childRel, state.walk.cursorRel);
    const counted = position === "at" || position === "after";
    if (counted && !state.walk.onEntry()) break;
    if (entry.kind === "link") {
      if (scope.port.followsLinks) state.walk.onLink();
      continue;
    }
    if (entry.kind === "directory") {
      yield* walkDirectoryEntry(state, childRel, entry, position);
      continue;
    }
    if (isCandidate(state, entry, childRel, position)) yield childRel;
  }
  if (layer !== undefined) state.layers.pop();
}

/** Whether a listed entry is a file this scope would search. */
function isCandidate(
  state: WalkState,
  entry: GrepEntry,
  rel: string,
  position: CursorPosition,
): boolean {
  if (entry.kind !== "file") return false;
  if (position === "before" || position === "ancestor") return false;
  const { scope } = state.walk;
  if (scope.port.ignoreFile !== undefined && entry.name === ".gitignore")
    return false;
  if (scope.glob !== undefined && !scope.glob.matchesFile(rel)) return false;
  return !isIgnored(state.layers, rel, false);
}

async function* walkDirectoryEntry(
  state: WalkState,
  rel: string,
  entry: GrepEntry,
  position: CursorPosition,
): AsyncGenerator<string> {
  const { scope } = state.walk;
  if (entry.name === ".git" || position === "before") return;
  if (isIgnored(state.layers, rel, true)) return;
  if (scope.glob !== undefined && !scope.glob.mayDescend(rel)) return;
  const identity = entry.identity;
  if (identity !== undefined) {
    if (state.ancestors.has(identity)) {
      if (scope.port.followsLinks) state.walk.onLink();
      return;
    }
    state.ancestors.add(identity);
  }
  yield* walkDirectory(state, rel);
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
  return { base: rel, rules: ignore().add(text) };
}

/**
 * A layer's rules see the path relative to that layer's directory. Later
 * layers sit deeper, so their verdict — including a negation — wins.
 */
function isIgnored(
  layers: ReadonlyArray<IgnoreLayer>,
  rel: string,
  directory: boolean,
): boolean {
  const pathname = directory ? `${rel}/` : rel;
  let ignored = false;
  for (const layer of layers) {
    const relative =
      layer.base.length === 0
        ? pathname
        : pathname.slice(layer.base.length + 1);
    const result = layer.rules.test(relative);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}

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
