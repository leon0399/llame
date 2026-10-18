/**
 * `SkillCatalog` is synchronous, and so is its file-system seam, while a
 * Machine is reached over an SSH session. So Run preparation walks a Machine
 * Workspace's three skill sources once, asynchronously, and hands the catalog
 * an in-memory file system holding exactly the paths the catalog asks for:
 * each source directory's immediate children, each package's `SKILL.md`, and
 * the two invocation-control sidecars beside it. Discovery, precedence, bounds,
 * and snapshot rules stay the catalog's own — this module never parses a
 * package or decides which source wins (remote-machines "Machine Workspace
 * skills come from the Machine").
 *
 * The snapshot is bounded (`MAX_MACHINE_SKILL_REQUESTS`,
 * `MAX_MACHINE_SKILL_BYTES`, `budgetMs`) so a slow or silent Machine cannot
 * stall preparation. A source it could not read is reported in `diagnostics`
 * and reads as absent, never as a thrown error, and an unreachable Machine
 * yields an empty catalog rather than a failure. Only a root that is not a
 * Machine path locator returns `undefined`, telling the caller to keep the
 * local catalog as it is.
 */

import path from 'node:path';

import type {
  FsListEntry,
  FsReadResult,
  JsonValue,
  MachineMethodParams,
  NativeFailureType,
  RequestEnvelope,
} from '@workspace/machine-protocol';

import {
  MACHINE_SCHEME,
  parseMachineLocator,
} from '../machines/machine-locator';
import {
  isNativeFailure,
  readFsListResult,
  readFsReadResult,
  readFsStatResult,
} from '../machines/machine-results';
import {
  MACHINE_PREPARATION_BUDGET_MS,
  machineEnvelope,
} from '../runs/machine-attempt';
import {
  MAX_SOURCE_CHILDREN,
  NODE_SKILL_FILE_SYSTEM,
  type CatalogDirent,
  type CatalogFileKind,
  type SkillCatalogFileSystem,
} from './skill-catalog';
import {
  machineWorkspaceSkillSources,
  type MachineSkillSource,
} from './workspace-skill-sources';

/** The methods a snapshot uses. `fs.stat` is what a link child resolves to:
 *  `fs.list` reports that a child is a link, never what it links to. */
export type MachineSkillMethod = 'fs.list' | 'fs.read' | 'fs.stat';

/**
 * One request over a Machine session, with the Machine bound by the caller.
 * The snapshot supplies the params (including the envelope) and the signal, so
 * a connector request bound to its Machine name is assignable as it stands.
 */
export type MachineSkillRequest = <M extends MachineSkillMethod>(
  method: M,
  params: MachineMethodParams[M],
  options?: { readonly signal?: AbortSignal },
) => Promise<JsonValue>;

/** Bound on the requests one snapshot may spend; each is an SSH round trip. */
export const MAX_MACHINE_SKILL_REQUESTS = 512;
/** Bound on the skill text one snapshot may hold in memory. */
export const MAX_MACHINE_SKILL_BYTES = 1024 * 1024;

const SKILL_DOCUMENT_FILENAME = 'SKILL.md';
/** The sidecars the catalog consults for invocation control, in its order. */
const SIDECAR_PATHS: ReadonlyArray<string> = [
  path.join('agents', 'llame.yaml'),
  path.join('agents', 'openai.yaml'),
];

const CANCELLED_MESSAGE =
  "The Machine skill snapshot was cancelled; the rest of the Machine Workspace's skills were skipped.";

/** A Machine skill path, in either spelling `path.join` can leave behind. */
const MACHINE_SKILL_PATH = new RegExp(`^${MACHINE_SCHEME}:/{1,2}`, 'iu');
/** A scheme whose `//` `path.join` collapsed, at the start of a path. */
const COLLAPSED_SCHEME = new RegExp(`^(${MACHINE_SCHEME}):/(?!/)`, 'iu');

export type MachineSkillSources = {
  /** Routes Machine-locator keys to the snapshot; every other path to NODE_SKILL_FILE_SYSTEM. */
  readonly fileSystem: SkillCatalogFileSystem;
  /** Diagnosed sources (empty when discovery could not run). */
  readonly diagnostics: ReadonlyArray<string>;
};

/**
 * Snapshot a Machine Workspace's skill sources for the synchronous catalog.
 *
 * The caller builds `request` once per attempt with the Machine name bound, the
 * way a tool call reaches the connector, and passes the sources
 * `workspaceSkillSources(root)` names to the same catalog snapshot. `budgetMs`
 * bounds the whole snapshot in wall-clock time as well as the relative budget
 * every request carries.
 */
export async function snapshotMachineSkillSources(input: {
  readonly root: string;
  readonly request: MachineSkillRequest;
  readonly signal?: AbortSignal;
  readonly budgetMs?: number;
}): Promise<MachineSkillSources | undefined> {
  const sources = machineWorkspaceSkillSources(input.root);
  if (sources === undefined) return undefined;

  const budgetMs = input.budgetMs ?? MACHINE_PREPARATION_BUDGET_MS;
  const deadline = AbortSignal.timeout(budgetMs);
  const snapshot = new MachineSkillSnapshot({
    sources,
    request: input.request,
    envelope: machineEnvelope({ budgetMs }),
    signal:
      input.signal === undefined
        ? deadline
        : AbortSignal.any([input.signal, deadline]),
    displayPrefix: `${MACHINE_SCHEME}://${sources[0].name}`,
  });
  await snapshot.collect();
  return { fileSystem: snapshot, diagnostics: [...snapshot.diagnostics] };
}

/** What one path the catalog may ask about looks like on the Machine. */
type MachineSkillFile = {
  readonly kind: CatalogFileKind;
  readonly text?: string;
};

/** One source directory, as the snapshot found it. */
type SnapshottedSource = {
  readonly source: MachineSkillSource;
  readonly dirents: Array<CatalogDirent>;
  /** Path relative to the source directory, as the catalog joins it. */
  readonly kinds: Map<string, CatalogFileKind>;
  readonly texts: Map<string, string>;
};

type SnapshotOptions = {
  readonly sources: ReadonlyArray<MachineSkillSource>;
  readonly request: MachineSkillRequest;
  readonly envelope: RequestEnvelope;
  readonly signal: AbortSignal;
  /** What the daemon prefixes to every path it renders: `machine://<name>`. */
  readonly displayPrefix: string;
};

/**
 * The in-memory file system one Machine Workspace's catalog reads, plus the one
 * asynchronous walk that fills it. Both spellings a source can arrive in are
 * accepted: the locator `workspaceSkillSources` builds and the `machine:/…`
 * text `path.join` leaves, which the catalog then joins children onto.
 */
class MachineSkillSnapshot implements SkillCatalogFileSystem {
  readonly diagnostics: Array<string> = [];
  private readonly byIdentity = new Map<string, SnapshottedSource>();
  private readonly spellings = new Map<string, SnapshottedSource>();
  private requests = 0;
  private bytes = 0;
  private stopped: string | undefined;

  constructor(private readonly options: SnapshotOptions) {}

  /** Walk every source once; afterwards the catalog reads nothing but memory. */
  async collect(): Promise<void> {
    for (const source of this.options.sources) {
      const snapshotted = await this.readSource(source);
      if (snapshotted === undefined) continue;
      this.byIdentity.set(`${source.name}\u0000${source.path}`, snapshotted);
      this.spellings.set(source.locator, snapshotted);
    }
  }

  readDirectory(directoryPath: string): ReadonlyArray<CatalogDirent> {
    if (!MACHINE_SKILL_PATH.test(directoryPath)) {
      return NODE_SKILL_FILE_SYSTEM.readDirectory(directoryPath);
    }
    const source = this.sourceOf(directoryPath);
    if (source === undefined) {
      throw new Error(
        `The Machine skill source ${directoryPath} was not read.`,
      );
    }
    // The catalog joins children onto this exact spelling, so remember it.
    this.spellings.set(directoryPath, source);
    return source.dirents;
  }

  fileKind(filePath: string): CatalogFileKind {
    if (!MACHINE_SKILL_PATH.test(filePath)) {
      return NODE_SKILL_FILE_SYSTEM.fileKind(filePath);
    }
    return this.locate(filePath)?.kind ?? 'unavailable';
  }

  readTextFile(filePath: string): string {
    if (!MACHINE_SKILL_PATH.test(filePath)) {
      return NODE_SKILL_FILE_SYSTEM.readTextFile(filePath);
    }
    const text = this.locate(filePath)?.text;
    if (text === undefined) {
      // The catalog catches this exactly as it catches a failed host read.
      throw new Error(
        `The Machine skill snapshot holds no text for ${filePath}.`,
      );
    }
    return text;
  }

  /** The snapshotted file at one path, in the spelling the catalog used. */
  private locate(filePath: string): MachineSkillFile | undefined {
    for (const [spelling, source] of this.spellings) {
      if (!filePath.startsWith(`${spelling}/`)) continue;
      const relative = filePath.slice(spelling.length + 1);
      const kind = source.kinds.get(relative);
      return kind === undefined
        ? undefined
        : { kind, text: source.texts.get(relative) };
    }
    return undefined;
  }

  /** The source one directory spelling names, whatever its spelling. */
  private sourceOf(directoryPath: string): SnapshottedSource | undefined {
    const parsed = parseMachineLocator(
      directoryPath.replace(COLLAPSED_SCHEME, '$1://'),
    );
    if (parsed.kind !== 'path') return undefined;
    return this.byIdentity.get(`${parsed.name}\u0000${parsed.path}`);
  }

  private async readSource(
    source: MachineSkillSource,
  ): Promise<SnapshottedSource | undefined> {
    const listed = await this.fetchList(source.path);
    if (listed === undefined) return undefined;
    const narrowed = this.narrow(readFsListResult, listed, source.locator);
    if (narrowed === undefined) return undefined;
    if (isNativeFailure(narrowed)) {
      // A source that is not there, or is not a directory, is skipped exactly
      // as a local one is; only a listing that failed for another reason is
      // worth reporting.
      if (
        narrowed.type !== 'not_found' &&
        narrowed.type !== 'not_regular_file'
      ) {
        this.diagnostics.push(
          `Skill source ${source.locator} is unreadable: ${narrowed.message}`,
        );
      }
      return undefined;
    }
    if (narrowed.truncated) {
      this.diagnostics.push(
        `Skill source ${source.locator} exceeds ${MAX_SOURCE_CHILDREN} children; the source is skipped.`,
      );
      return undefined;
    }

    const pending: SnapshottedSource = {
      source,
      dirents: [],
      kinds: new Map(),
      texts: new Map(),
    };
    for (const entry of narrowed.entries) {
      pending.dirents.push({
        name: entry.name,
        isDirectory: () => entry.kind === 'directory',
        isSymbolicLink: () => entry.kind === 'link',
      });
      if (!(await this.collectChild(pending, entry))) return undefined;
    }
    return pending;
  }

  /** Read what the catalog will ask about one child; false when it stopped. */
  private async collectChild(
    pending: SnapshottedSource,
    entry: FsListEntry,
  ): Promise<boolean> {
    if (entry.kind !== 'directory' && entry.kind !== 'link') return true;
    if (entry.kind === 'link') {
      const target = await this.followedKind(
        path.posix.join(pending.source.path, entry.name),
      );
      if (target === undefined) return false;
      pending.kinds.set(entry.name, target);
      if (target !== 'directory') return true;
    }
    // A link to a directory is published at its link path, so the package is
    // read through the link exactly as the catalog will ask for it.
    const document = await this.read(
      pending,
      entry.name,
      SKILL_DOCUMENT_FILENAME,
    );
    if (document === undefined) return false;
    if (document.kind !== 'file' || document.text === undefined) return true;
    for (const sidecar of SIDECAR_PATHS) {
      if ((await this.read(pending, entry.name, sidecar)) === undefined) {
        return false;
      }
    }
    return true;
  }

  /** Read one file of one package and record it under its relative path. */
  private async read(
    pending: SnapshottedSource,
    child: string,
    relativePath: string,
  ): Promise<MachineSkillFile | undefined> {
    const filePath = path.posix.join(pending.source.path, child, relativePath);
    const answer = await this.fetchRead(filePath);
    if (answer === undefined) return undefined;
    const narrowed = this.narrow(
      readFsReadResult,
      answer,
      `${this.options.displayPrefix}${filePath}`,
    );
    if (narrowed === undefined) return undefined;

    const file = fileOf(narrowed);
    const key = path.join(child, relativePath);
    pending.kinds.set(key, file.kind);
    if (file.text !== undefined) {
      pending.texts.set(key, file.text);
      this.bytes += file.text.length;
    }
    return file;
  }

  /** What a link child resolves to; undefined when the snapshot stopped. */
  private async followedKind(
    childPath: string,
  ): Promise<CatalogFileKind | undefined> {
    const answer = await this.fetchStat(childPath);
    if (answer === undefined) return undefined;
    const narrowed = this.narrow(
      readFsStatResult,
      answer,
      `${this.options.displayPrefix}${childPath}`,
    );
    if (narrowed === undefined) return undefined;
    // The daemon follows the link, so this is the target's kind: a dangling
    // link reads `missing` there and `unavailable` locally, which the catalog
    // reports the same way.
    if (narrowed.kind === 'directory') return 'directory';
    return narrowed.kind === 'file' ? 'file' : 'unavailable';
  }

  private async fetchList(filePath: string): Promise<JsonValue | undefined> {
    return this.send(() =>
      this.options.request(
        'fs.list',
        { envelope: this.options.envelope, path: filePath },
        { signal: this.options.signal },
      ),
    );
  }

  private async fetchRead(filePath: string): Promise<JsonValue | undefined> {
    return this.send(() =>
      this.options.request(
        'fs.read',
        {
          envelope: this.options.envelope,
          path: filePath,
          // An empty display prefix is refused; the report itself is unused.
          options: { displayPrefix: this.options.displayPrefix },
        },
        { signal: this.options.signal },
      ),
    );
  }

  private async fetchStat(filePath: string): Promise<JsonValue | undefined> {
    return this.send(() =>
      this.options.request(
        'fs.stat',
        { envelope: this.options.envelope, path: filePath },
        { signal: this.options.signal },
      ),
    );
  }

  /** One bounded request; undefined when the snapshot may not or cannot send it. */
  private async send(
    request: () => Promise<JsonValue>,
  ): Promise<JsonValue | undefined> {
    if (!this.permit()) return undefined;
    try {
      return await request();
    } catch (error) {
      this.stop(
        this.options.signal.aborted
          ? CANCELLED_MESSAGE
          : `The Machine skill snapshot failed: ${
              error instanceof Error ? error.message : 'an unknown failure'
            }`,
      );
      return undefined;
    }
  }

  /** Reserve one request, or stop the snapshot at the bound it reached. */
  private permit(): boolean {
    if (this.stopped !== undefined) return false;
    if (this.options.signal.aborted) {
      this.stop(CANCELLED_MESSAGE);
      return false;
    }
    if (this.requests >= MAX_MACHINE_SKILL_REQUESTS) {
      this.stop(
        `The Machine skill snapshot reached its ${MAX_MACHINE_SKILL_REQUESTS}-request bound; the rest of the Machine Workspace's skills were skipped.`,
      );
      return false;
    }
    if (this.bytes >= MAX_MACHINE_SKILL_BYTES) {
      this.stop(
        `The Machine skill snapshot reached its ${MAX_MACHINE_SKILL_BYTES}-byte bound; the rest of the Machine Workspace's skills were skipped.`,
      );
      return false;
    }
    this.requests += 1;
    return true;
  }

  /**
   * Record the one reason the snapshot stopped. It is called once: every later
   * request is refused by `permit` before it can fail again.
   */
  private stop(reason: string): void {
    this.stopped = reason;
    this.diagnostics.push(reason);
  }

  /** Narrow one untrusted answer, stopping the snapshot when it is not one. */
  private narrow<T>(
    read: (value: JsonValue) => T | undefined,
    value: JsonValue,
    at: string,
  ): T | undefined {
    const narrowed = read(value);
    if (narrowed === undefined) {
      this.stop(
        `The Machine skill snapshot read an unreadable result at ${at}`,
      );
    }
    return narrowed;
  }
}

/** What one `fs.read` answer proves about a path the catalog asks about. */
function fileOf(result: FsReadResult): MachineSkillFile {
  if (result.status === 'error') return { kind: kindOfRefusal(result.type) };
  if (result.kind === 'directory') return { kind: 'directory' };
  // `fs.read` never answers with a media shape: the daemon reads without a
  // media hook, so anything else is not a skill document at all.
  if (result.kind !== 'file') return { kind: 'unavailable' };
  // A bounded read is never parsed as if it were the whole document.
  return result.truncated
    ? { kind: 'file' }
    : { kind: 'file', text: result.content };
}

/**
 * The kind a refusal proves: absence, the wrong entry kind, or a regular file
 * the Machine declined to hand over as text — which the catalog reports as an
 * unreadable document rather than as a missing one.
 */
function kindOfRefusal(type: NativeFailureType): CatalogFileKind {
  if (type === 'not_found') return 'missing';
  return type === 'not_regular_file' ? 'unavailable' : 'file';
}
