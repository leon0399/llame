/**
 * The `instructions` producer (workspace instruction files D3–D10): trigger
 * projection, exclusions, and the once-per-epoch seen set. Real temporary
 * directories hold the candidate chains; the page reader is a fake so a test
 * can make one candidate deny without a permission policy, since the
 * producer's contract is the page result, not the runner.
 */

import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { splitSelectorSuffix } from '@workspace/native-file-tools';

import type { AuthoredContextItemPart } from '../chats/context-item';
import {
  isInstructionsPayload,
  instructionsSeenPaths,
} from '../chats/instructions-item';
import { type ReadPage, parentKey } from './instruction-files';
import type { InRunToolCall } from '../runs/in-run-context-items';
import { enterWorkspaceTool, exitWorkspaceTool } from '../tools/workspace';
import { KNOWLEDGE_MAX_PATH_COMPONENTS } from '../knowledge/knowledge-filesystem-limits';
import {
  createKnowledgeInstructionProbe,
  type KnowledgeInstructionProbe,
} from '../knowledge/knowledge-instruction-probe';
import { KNOWLEDGE_CONTENT_NOTICE } from '../knowledge/knowledge-content-notice';
import { type KnowledgeToolResolver } from '../tools/types';
import { createInstructionsProducer } from './instructions-producer';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

/** The trigger every scenario resolves against; a real temp directory. */
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'llame-instructions-producer-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Writes `content` at `path`, creating its parent directories. */
async function write(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
}

/** A page reader over the real files, recording every selector it was asked for. */
function pageReader() {
  const reads: Array<string> = [];
  const canonicalPaths: Array<string | undefined> = [];
  const readPage: ReadPage = async (selectorPath, canonicalPath) => {
    reads.push(selectorPath);
    canonicalPaths.push(canonicalPath);
    const marker = selectorPath.lastIndexOf(':raw:');
    const path = marker < 0 ? selectorPath : selectorPath.slice(0, marker);
    const content = await readFile(path, 'utf8');
    return { status: 'success', kind: 'file', content, truncated: false };
  };
  return { readPage, reads, canonicalPaths };
}

/** One attempt's producer plus the items it stages at each step. */
function attemptOf(
  input: {
    readonly seenKeys?: ReadonlySet<string>;
    /** `null` builds the attempt with no page reader at all. */
    readonly readPage?: ReadPage | null;
    readonly admitsRead?: (path: string) => boolean;
    /** The Space capability; absent builds an attempt without one. */
    readonly space?: {
      readonly readPage: ReadPage;
      readonly knowledge: KnowledgeInstructionProbe;
    };
  } = {},
) {
  const staged: Array<AuthoredContextItemPart> = [];
  const readPage =
    input.readPage === null
      ? undefined
      : (input.readPage ?? pageReader().readPage);
  const space = input.space;
  const producer = createInstructionsProducer().beginAttempt({
    runId: RUN_ID,
    chatId: '22222222-2222-4222-8222-222222222222',
    userId: 'owner',
    admitsRead: input.admitsRead ?? (() => true),
    ...(input.seenKeys !== undefined && { seenKeys: input.seenKeys }),
    ...(readPage !== undefined && { readPage }),
    ...(space !== undefined && {
      knowledge: { readPage: space.readPage, probe: space.knowledge },
    }),
  });
  return {
    producer,
    staged,
    prepare: async () => {
      await producer.prepareStep({
        messages: [],
        stepNumber: 1,
        stage: (part) => {
          staged.push(part);
        },
      });
    },
  };
}

/** The selected paths an item discloses, in block order. */
function blockPaths(part: AuthoredContextItemPart): Array<string> {
  const payload = part.data.payload;
  if (!isInstructionsPayload(payload)) {
    throw new Error('the staged part is not an instructions payload');
  }
  return payload.files.map((file) => file.path);
}
function loadedFiles(part: AuthoredContextItemPart): ReadonlyArray<{
  readonly path: string;
  readonly canonicalPath: string;
  readonly truncated: boolean;
  readonly importedBy?: string;
}> {
  const payload = part.data.payload;
  if (!isInstructionsPayload(payload)) {
    throw new Error('the staged part is not an instructions payload');
  }
  return payload.files;
}
function deniedPaths(part: AuthoredContextItemPart): Array<string> {
  const payload = part.data.payload;
  if (!isInstructionsPayload(payload)) {
    throw new Error('the staged part is not an instructions payload');
  }
  return [...payload.denied];
}

/** The canonical seen keys an item discloses. */
function seenKeys(part: AuthoredContextItemPart): Array<string> {
  return [...instructionsSeenPaths([part])];
}

/** The fixture paths of `paths`, in order, ignoring anything above `root`. */
function withinRoot(paths: ReadonlyArray<string>): Array<string> {
  return paths.filter((path) => path.startsWith(`${root}/`));
}

/** The last item a step staged, failing loudly when the step staged none. */
function lastStaged(
  staged: ReadonlyArray<AuthoredContextItemPart>,
): AuthoredContextItemPart {
  const part = staged.at(-1);
  if (part === undefined) throw new Error('the step staged no item');
  return part;
}

function readCall(path: string, toolName = 'read'): InRunToolCall {
  return { toolName, input: { path }, workspaceRoot: root };
}

const SPACE = 'a6230f3c-4a5e-4c9b-8f0e-1d2c3b4a5e6f';
const OTHER_SPACE = 'b6230f3c-4a5e-4c9b-8f0e-1d2c3b4a5e6f';

/** One in-memory Space, every key it was asked about, and its page reads. */
function spaceOf(
  files: Readonly<Record<string, string>>,
  knowledgeSpaceId = SPACE,
) {
  const reads: Array<string> = [];
  const probes: Array<string> = [];
  const asked: Array<string> = [];
  const directories = new Set<string>(['']);
  for (const key of Object.keys(files)) {
    for (let parent = parentKey(key, ''); ; parent = parentKey(parent, '')) {
      directories.add(parent);
      if (parent === '') break;
    }
  }
  const entries = [...directories, ...Object.keys(files)];
  // A real probe resolves the Space under RLS, which matches an identifier
  // whatever its case, so this one does too: an upper-case id names the same
  // Space. Only the producer's own canonical-only rule keeps such a locator
  // from ever reaching it.
  const knowledge: KnowledgeInstructionProbe = (spaceId) => {
    asked.push(spaceId);
    return Promise.resolve(
      spaceId.toLowerCase() === knowledgeSpaceId.toLowerCase()
        ? {
            probe(relativePath) {
              probes.push(relativePath);
              const body = files[relativePath];
              if (body !== undefined) {
                return Promise.resolve({
                  kind: 'file' as const,
                  size: Buffer.byteLength(body),
                });
              }
              return Promise.resolve(
                directories.has(relativePath)
                  ? { kind: 'directory' as const, size: 0 }
                  : { kind: 'missing' as const },
              );
            },
            list(relativeDirectory) {
              probes.push(relativeDirectory);
              const prefix =
                relativeDirectory === '' ? 0 : relativeDirectory.length + 1;
              return Promise.resolve(
                entries.flatMap((key) =>
                  parentKey(key, '') === relativeDirectory
                    ? [key.slice(prefix)]
                    : [],
                ),
              );
            },
          }
        : undefined,
    );
  };
  const readPage: ReadPage = (selectorPath) => {
    reads.push(selectorPath);
    // Only a canonical lower-case id reaches a read at all, so the locator
    // prefix strips a Space id that identifies this Space here.
    const key = selectorPath
      .replace(/^kb:\/\/[^/]+\//iu, '')
      .replace(/:raw:\d+-\d+$/u, '');
    const body = files[key];
    return Promise.resolve(
      body === undefined
        ? { status: 'error', type: 'not_found', message: 'No such file.' }
        : {
            status: 'success',
            kind: 'file',
            content: body,
            truncated: false,
          },
    );
  };
  return { knowledge, readPage, reads, probes, asked };
}

/** One `kb://` read call, in a Space that exists. */
function spaceCall(
  relativePath: string,
  toolName = 'read',
  spaceId = SPACE,
): InRunToolCall {
  return {
    toolName,
    input: { path: `kb://${spaceId}/${relativePath}` },
    workspaceRoot: root,
  };
}

describe('instructions producer Knowledge Space triggers', () => {
  it("loads the Space root's chain and the touched directory's, labelled by locator", async () => {
    await write(join(root, 'AGENTS.md'), 'host rules\n');
    const space = spaceOf({
      'CLAUDE.md': 'space rules\n',
      'notes/AGENTS.md': 'note rules\n',
      'notes/lore/x.md': 'lore\n',
      'other/AGENTS.md': 'other rules\n',
    });
    const { producer, staged, prepare } = attemptOf({ space });

    producer.observeToolCall?.(spaceCall('notes/lore/x.md'));
    await prepare();

    // Broadest directory first, base before local, and a sibling directory of
    // the touched one is never visited.
    expect(blockPaths(lastStaged(staged))).toEqual([
      `kb://${SPACE}/CLAUDE.md`,
      `kb://${SPACE}/notes/AGENTS.md`,
    ]);
    expect(space.reads).toEqual([
      `kb://${SPACE}/CLAUDE.md:raw:1-2000`,
      `kb://${SPACE}/notes/AGENTS.md:raw:1-2000`,
    ]);
    // Nothing of the host Workspace leaks into a Space bundle.
    expect(withinRoot(blockPaths(lastStaged(staged)))).toEqual([]);
    // The keys are the locators, so a later touch of the same file is seen.
    expect(seenKeys(lastStaged(staged))).toEqual([
      `kb://${SPACE}/CLAUDE.md`,
      `kb://${SPACE}/notes/AGENTS.md`,
    ]);
  });

  it('probes nothing above the Space root', async () => {
    const space = spaceOf({ 'notes/lore/AGENTS.md': 'lore rules\n' });
    const { producer, staged, prepare } = attemptOf({ space });

    producer.observeToolCall?.(spaceCall('notes/lore/x.md'));
    await prepare();

    // Every key the walk resolved is a Space-relative path under the Space:
    // the broadest is its own directory, and nothing above it was ever asked
    // for, so no host ancestor is reachable.
    expect(space.probes).toContain('');
    expect(
      space.probes.filter((key) => key.startsWith('/') || key.includes('..')),
    ).toEqual([]);
    expect(blockPaths(lastStaged(staged))).toEqual([
      `kb://${SPACE}/notes/lore/AGENTS.md`,
    ]);
  });

  it('stages nothing for a Space id that is not in canonical form', async () => {
    const space = spaceOf({
      'x.md': 'first\n',
      'notes/y.md': 'second\n',
      'notes/AGENTS.md': 'note rules\n',
    });
    const { producer, staged, prepare } = attemptOf({ space });

    // Only the lower-case id llame itself formats is a trigger, so an
    // upper-case locator names no instruction file to load: it asks the
    // owner's resolver about no Space at all, reads nothing, and stages
    // nothing — even though that resolver would happily resolve the id.
    producer.observeToolCall?.(spaceCall('x.md', 'read', SPACE.toUpperCase()));
    await prepare();

    expect(staged).toEqual([]);
    expect(space.asked).toEqual([]);
    expect(space.probes).toEqual([]);
    expect(space.reads).toEqual([]);
  });

  it('loads a canonical locator in the same step as an upper-case one', async () => {
    const space = spaceOf({
      'x.md': 'first\n',
      'notes/y.md': 'second\n',
      'notes/AGENTS.md': 'note rules\n',
    });
    const { producer, staged, prepare } = attemptOf({ space });

    // The upper-case call is not a trigger and the lower-case one is, so the
    // step stages the chain of the one directory it named.
    producer.observeToolCall?.(spaceCall('x.md', 'read', SPACE.toUpperCase()));
    producer.observeToolCall?.(spaceCall('notes/y.md'));
    await prepare();

    expect(staged).toHaveLength(1);
    expect(blockPaths(lastStaged(staged))).toEqual([
      `kb://${SPACE}/notes/AGENTS.md`,
    ]);
    // Every group, label, seen key, and read agrees on the canonical spelling,
    // which is also the only one the `read` rule is evaluated under.
    expect(space.reads).toEqual([`kb://${SPACE}/notes/AGENTS.md:raw:1-2000`]);
    expect(seenKeys(lastStaged(staged))).toEqual([
      `kb://${SPACE}/notes/AGENTS.md`,
    ]);

    // The key is canonical, so a later touch of the same file is already seen
    // and loads nothing.
    producer.observeToolCall?.(
      spaceCall('notes/AGENTS.md', 'read', SPACE.toUpperCase()),
    );
    await prepare();
    expect(staged).toHaveLength(1);
  });

  it("loads the Space root's chain for a locator naming only the Space", async () => {
    const space = spaceOf({ 'CLAUDE.md': 'space rules\n' });

    // Both spellings of "the Space's own directory" walk it: the trigger has
    // no relative path at all, so the only key the walk may ask the trusted
    // resolver about is the Space root itself and its own candidates.
    for (const locator of [`kb://${SPACE}`, `kb://${SPACE}/`]) {
      const { producer, staged, prepare } = attemptOf({ space });
      const before = space.probes.length;

      producer.observeToolCall?.({
        toolName: 'read',
        input: { path: locator },
        workspaceRoot: root,
      });
      await prepare();

      expect(blockPaths(lastStaged(staged))).toEqual([
        `kb://${SPACE}/CLAUDE.md`,
      ]);
      expect(space.probes.slice(before).filter((key) => key !== '')).toEqual([
        'CLAUDE.md',
      ]);
    }
  });

  it('loads nothing for a locator the Knowledge resolver would refuse', async () => {
    const space = spaceOf({
      'notes/y.md': 'y\n',
      'notes/AGENTS.md': 'note rules\n',
    });
    const { producer, staged, prepare } = attemptOf({ space });
    const tooDeep = [
      ...Array.from(
        { length: KNOWLEDGE_MAX_PATH_COMPONENTS },
        (_, index) => `d${index}`,
      ),
      'x.md',
    ].join('/');

    producer.observeToolCall?.(spaceCall(tooDeep));
    producer.observeToolCall?.(spaceCall('notes/y.md'));
    await prepare();

    // Only the in-cap trigger marked a directory to walk; the deeper locator
    // named no Space at all.
    expect(space.probes).not.toContain(tooDeep);
    expect(blockPaths(lastStaged(staged))).toEqual([
      `kb://${SPACE}/notes/AGENTS.md`,
    ]);
  });

  it('loads nothing when the Space binding cannot be resolved', async () => {
    const failure = `Space directory ${root}/spaces/${SPACE} is unreadable`;
    const resolver: KnowledgeToolResolver = {
      listForOwnerPage: () => Promise.reject(new Error(failure)),
      resolveBindingForOwnerById: () => Promise.reject(new Error(failure)),
      createAdapter: () => {
        throw new Error(failure);
      },
    };
    const space = spaceOf({ 'CLAUDE.md': 'space rules\n' });
    const { producer, staged, prepare } = attemptOf({
      space: {
        readPage: space.readPage,
        knowledge: createKnowledgeInstructionProbe({
          resolver,
          ownerUserId: 'owner',
        }),
      },
    });

    producer.observeToolCall?.(spaceCall('CLAUDE.md'));
    await prepare();

    // The store failed, so no Space is resolved, nothing is probed, and the
    // host path its message carries reaches no item at all.
    expect(staged).toEqual([]);
    expect(space.probes).toEqual([]);
    expect(space.reads).toEqual([]);
    expect(JSON.stringify(staged)).not.toContain(root);
  });

  it('loads nothing for a Space that is not this owner’s', async () => {
    const space = spaceOf({ 'CLAUDE.md': 'space rules\n' });
    const { producer, staged, prepare } = attemptOf({ space });

    for (const locator of [
      `kb://${OTHER_SPACE}/doc.md`,
      `kb://${SPACE}/../${OTHER_SPACE}/doc.md`,
      `kb://${SPACE}/notes//doc.md`,
    ]) {
      producer.observeToolCall?.({
        toolName: 'read',
        input: { path: locator },
        workspaceRoot: root,
      });
    }
    await prepare();

    expect(staged).toEqual([]);
    expect(space.reads).toEqual([]);
  });

  it('skips the candidate a Space read disclosed, by locator', async () => {
    const space = spaceOf({
      'notes/AGENTS.md': 'note rules\n',
      'notes/CLAUDE.local.md': 'local rules\n',
    });
    const { producer, staged, prepare } = attemptOf({ space });

    producer.observeToolCall?.(spaceCall('notes/AGENTS.md'));
    await prepare();

    // The read disclosed the base candidate of the touched directory; the
    // local candidate beside it still loads, and nothing is marked seen.
    expect(blockPaths(lastStaged(staged))).toEqual([
      `kb://${SPACE}/notes/CLAUDE.local.md`,
    ]);
    expect(seenKeys(lastStaged(staged))).not.toContain(
      `kb://${SPACE}/notes/AGENTS.md`,
    );
  });

  it('stages one bundle with the host files first for a host and Space touch', async () => {
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');
    const space = spaceOf({ 'notes/lore/AGENTS.md': 'lore rules\n' });
    const { producer, staged, prepare } = attemptOf({ space });

    producer.observeToolCall?.(spaceCall('notes/lore/x.md'));
    producer.observeToolCall?.(readCall(join(root, 'apps/api/src/x.ts')));
    await prepare();

    expect(staged).toHaveLength(1);
    expect(blockPaths(lastStaged(staged))).toEqual([
      join(root, 'apps/api/AGENTS.md'),
      `kb://${SPACE}/notes/lore/AGENTS.md`,
    ]);
    // The bundle carries owner-maintained Knowledge content, so the closed
    // untrusted-and-may-be-stale notice is in it once.
    expect(lastStaged(staged).data.text).toContain(KNOWLEDGE_CONTENT_NOTICE);
    expect(
      lastStaged(staged).data.text.split(KNOWLEDGE_CONTENT_NOTICE),
    ).toHaveLength(2);
  });

  it('loads nothing for a Space id spelled under another scheme', async () => {
    const space = spaceOf({ 'notes/AGENTS.md': 'note rules\n' });
    const { producer, staged, prepare } = attemptOf({ space });

    // `kb://` is the one scheme that names a Space: the same id and path under
    // any other scheme is a remote resource, never a local candidate.
    for (const scheme of ['https', 'mcp']) {
      // A path that is not itself a candidate, so nothing here can be
      // dismissed as a read that disclosed the file it named.
      producer.observeToolCall?.(readCall(`${scheme}://${SPACE}/notes/x.md`));
    }
    await prepare();

    expect(staged).toEqual([]);
    expect(space.probes).toEqual([]);
    expect(space.reads).toEqual([]);
  });

  it('ignores a knowledge search and any trigger without its Space capability', async () => {
    await write(join(root, 'AGENTS.md'), 'host rules\n');
    const space = spaceOf({ 'CLAUDE.md': 'space rules\n' });
    const searched = attemptOf({ space });
    searched.producer.observeToolCall?.({
      toolName: 'knowledge_search',
      input: { query: 'rules', space: SPACE },
      workspaceRoot: root,
    });
    await searched.prepare();
    expect(searched.staged).toEqual([]);

    // A host-only process never probes the host filesystem for a Space
    // trigger, and a Space-less attempt never loads a host file.
    const hostOnly = attemptOf();
    hostOnly.producer.observeToolCall?.(spaceCall('doc.md'));
    await hostOnly.prepare();
    expect(hostOnly.staged).toEqual([]);

    const spaceOnly = attemptOf({ readPage: null, space });
    spaceOnly.producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await spaceOnly.prepare();
    expect(spaceOnly.staged).toEqual([]);
    expect(space.reads).toEqual([]);
  });

  it('loads a Space trigger on an attempt with no host page reader', async () => {
    const space = spaceOf({ 'notes/AGENTS.md': 'note rules\n' });
    const { producer, staged, prepare } = attemptOf({ readPage: null, space });

    producer.observeToolCall?.(spaceCall('notes/x.md'));
    await prepare();

    // Each world is gated by its own capability: no host page reader stops the
    // host chain, not the Space one, which still walks and reads.
    expect(blockPaths(lastStaged(staged))).toEqual([
      `kb://${SPACE}/notes/AGENTS.md`,
    ]);
    expect(space.reads).toEqual([`kb://${SPACE}/notes/AGENTS.md:raw:1-2000`]);
  });
});

describe('instructions producer triggers', () => {
  it('loads the chain from the filesystem root down to the touched directory', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');
    // A sibling of the touched directory is never visited.
    await write(join(root, 'apps/web/AGENTS.md'), 'web rules\n');
    const { producer, staged, prepare } = attemptOf();

    producer.observeToolCall?.(readCall(join(root, 'apps/api/src/x.ts')));
    await prepare();

    expect(staged).toHaveLength(1);
    const part = lastStaged(staged);
    expect(withinRoot(blockPaths(part))).toEqual([
      join(root, 'AGENTS.md'),
      join(root, 'apps/api/AGENTS.md'),
    ]);
    // The rendered text carries the blocks in the same order.
    expect(part.data.text.indexOf(join(root, 'AGENTS.md'))).toBeLessThan(
      part.data.text.indexOf(join(root, 'apps/api/AGENTS.md')),
    );
    // Host files are repository content: no Knowledge notice.
    expect(part.data.text).not.toContain(KNOWLEDGE_CONTENT_NOTICE);
    // A step with no pending trigger stages nothing new.
    await prepare();
    expect(staged).toHaveLength(1);
  });

  it('treats a selector or representation suffix as the plain path', async () => {
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');
    await write(join(root, 'apps/api/src/AGENTS.md'), 'src rules\n');

    for (const suffix of [':40-80', ':outline', ':raw:1-2000']) {
      const { producer, staged, prepare } = attemptOf();
      producer.observeToolCall?.(
        readCall(`${join(root, 'apps/api/src/x.ts')}${suffix}`),
      );
      await prepare();
      expect(withinRoot(blockPaths(lastStaged(staged)))).toEqual([
        join(root, 'apps/api/AGENTS.md'),
        join(root, 'apps/api/src/AGENTS.md'),
      ]);
    }
  });

  it('projects a relative path against the root and a file alias to its host path', async () => {
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');

    const relative = attemptOf();
    relative.producer.observeToolCall?.({
      toolName: 'read',
      input: { path: 'apps/api/src/x.ts' },
      workspaceRoot: root,
    });
    await relative.prepare();
    expect(withinRoot(blockPaths(lastStaged(relative.staged)))).toEqual([
      join(root, 'apps/api/AGENTS.md'),
    ]);

    const aliased = attemptOf();
    aliased.producer.observeToolCall?.(
      readCall(`file://${join(root, 'apps/api/src/x.ts')}`),
    );
    await aliased.prepare();
    expect(withinRoot(blockPaths(lastStaged(aliased.staged)))).toEqual([
      join(root, 'apps/api/AGENTS.md'),
    ]);
  });

  it('triggers on edit and write, but not on other tools or locators', async () => {
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');

    for (const toolName of ['edit', 'write']) {
      const { producer, staged, prepare } = attemptOf();
      producer.observeToolCall?.(
        readCall(join(root, 'apps/api/x.ts'), toolName),
      );
      await prepare();
      expect(blockPaths(lastStaged(staged))).toContain(
        join(root, 'apps/api/AGENTS.md'),
      );
    }

    const ignored: Array<InRunToolCall> = [
      {
        toolName: 'bash',
        input: { command: 'ls', cwd: 'apps/api' },
        workspaceRoot: root,
      },
      readCall('kb://not-a-uuid/doc.md'),
      readCall('skill://name'),
      readCall('https://example.com/AGENTS.md'),
      readCall(join(root, 'apps/api/x.ts'), 'search_conversations'),
    ];
    const { producer, staged, prepare } = attemptOf();
    for (const call of ignored) producer.observeToolCall?.(call);
    await prepare();
    expect(staged).toEqual([]);
  });

  it('loads a candidate its own edit or write named, which a read would skip', async () => {
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');

    // Only a read discloses the file it named; a write discloses nothing, so
    // the very file being written is announced.
    for (const toolName of ['edit', 'write']) {
      const { producer, staged, prepare } = attemptOf();
      producer.observeToolCall?.(
        readCall(join(root, 'apps/api/AGENTS.md'), toolName),
      );
      await prepare();
      expect(withinRoot(blockPaths(lastStaged(staged)))).toEqual([
        join(root, 'apps/api/AGENTS.md'),
      ]);
    }
  });

  it('marks an entry that established or switched the binding, and nothing else', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');

    for (const [state, expected] of [
      ['bound', 1],
      ['switched', 1],
      ['unchanged', 0],
      ['fence_lost', 0],
    ] as const) {
      const { producer, staged, prepare } = attemptOf();
      producer.observeToolCall?.({
        toolName: enterWorkspaceTool.id,
        input: { path: root },
        workspaceRoot: undefined,
        result: { status: 'success', root, state },
      });
      await prepare();
      expect(staged).toHaveLength(expected);
    }
  });

  it('resolves two touches in one step into one bundle in directory order', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');
    await write(join(root, 'apps/web/AGENTS.md'), 'web rules\n');
    const { producer, staged, prepare } = attemptOf();

    // Touched widest-first: the bundle still walks broadest-first.
    producer.observeToolCall?.(readCall(join(root, 'apps/web/b.ts')));
    producer.observeToolCall?.(readCall(join(root, 'apps/api/a.ts')));
    await prepare();

    expect(staged).toHaveLength(1);
    expect(withinRoot(blockPaths(lastStaged(staged)))).toEqual([
      join(root, 'AGENTS.md'),
      join(root, 'apps/api/AGENTS.md'),
      join(root, 'apps/web/AGENTS.md'),
    ]);
  });

  it('does not load a file the attempt has already seen', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    const canonical = await realpath(join(root, 'AGENTS.md'));
    const { readPage, reads } = pageReader();
    const { producer, staged, prepare } = attemptOf({
      seenKeys: new Set([canonical]),
      readPage,
    });

    producer.observeToolCall?.(readCall(join(root, 'apps/api/x.ts')));
    await prepare();

    expect(staged).toEqual([]);
    expect(reads).toEqual([]);
  });

  it('skips a candidate the read itself disclosed without marking it seen', async () => {
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');
    await write(join(root, 'apps/api/CLAUDE.local.md'), 'local rules\n');
    const { producer, staged, prepare } = attemptOf();

    producer.observeToolCall?.(readCall(join(root, 'apps/api/AGENTS.md')));
    await prepare();

    // The base candidate the model read is skipped; the chain's other
    // candidates still load, and the skipped file stays unseen.
    expect(withinRoot(blockPaths(lastStaged(staged)))).toEqual([
      join(root, 'apps/api/CLAUDE.local.md'),
    ]);
    expect(seenKeys(lastStaged(staged))).not.toContain(
      join(root, 'apps/api/AGENTS.md'),
    );

    // A later plain touch loads it.
    producer.observeToolCall?.(readCall(join(root, 'apps/api/x.ts')));
    await prepare();
    expect(withinRoot(blockPaths(lastStaged(staged)))).toEqual([
      join(root, 'apps/api/AGENTS.md'),
    ]);
  });

  it('skips the candidate a read disclosed through a symlink', async () => {
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');
    await symlink(
      join(root, 'apps/api/AGENTS.md'),
      join(root, 'apps/api/CLAUDE.md'),
    );
    const { producer, staged, prepare } = attemptOf();

    // The link resolves to the very candidate this directory would select, so
    // the read already disclosed it: the chain contributes nothing.
    producer.observeToolCall?.(readCall(join(root, 'apps/api/CLAUDE.md')));
    await prepare();
    expect(staged).toEqual([]);

    // Excluded, not marked seen: a later plain touch loads it.
    producer.observeToolCall?.(readCall(join(root, 'apps/api/x.ts')));
    await prepare();
    expect(withinRoot(blockPaths(lastStaged(staged)))).toEqual([
      join(root, 'apps/api/AGENTS.md'),
    ]);
  });

  it('loads the same file for a sibling directory that did not disclose it', async () => {
    const target = join(root, 'shared/RULES.md');
    await write(target, 'shared rules\n');
    await mkdir(join(root, 'apps/api'), { recursive: true });
    await mkdir(join(root, 'apps/web'), { recursive: true });
    await symlink(target, join(root, 'apps/api/CLAUDE.md'));
    await symlink(target, join(root, 'apps/web/AGENTS.md'));
    const { producer, staged, prepare } = attemptOf();

    // One step, two touches: the disclosure is scoped to the directory its
    // read resolved to, so the sibling's identical file still loads.
    producer.observeToolCall?.(readCall(join(root, 'apps/api/CLAUDE.md')));
    producer.observeToolCall?.(readCall(join(root, 'apps/web/index.ts')));
    await prepare();

    expect(withinRoot(blockPaths(lastStaged(staged)))).toEqual([
      join(root, 'apps/web/AGENTS.md'),
    ]);
    // Loaded once, under the path it was selected at.
    expect(seenKeys(lastStaged(staged))).toEqual([await realpath(target)]);
  });

  it('loads nothing without a page reader', async () => {
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');
    // The read gate: no page reader means no trigger can load anything.
    const gated = attemptOf({ readPage: null });
    gated.producer.observeToolCall?.(readCall(join(root, 'apps/api/x.ts')));
    await gated.prepare();
    expect(gated.staged).toEqual([]);
  });

  it('collapses a symlinked chain to its target and loads each file once', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');
    await mkdir(join(root, 'apps/api/src'), { recursive: true });
    await symlink(
      join(root, 'apps/api/AGENTS.md'),
      join(root, 'apps/api/src/AGENTS.md'),
    );
    const { producer, staged, prepare } = attemptOf();

    producer.observeToolCall?.(readCall(join(root, 'apps/api/src/x.ts')));
    await prepare();

    expect(withinRoot(blockPaths(lastStaged(staged)))).toEqual([
      join(root, 'AGENTS.md'),
      join(root, 'apps/api/AGENTS.md'),
    ]);
  });

  it("loads a directory read as that directory's own chain", async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');
    const { producer, staged, prepare } = attemptOf();

    producer.observeToolCall?.(readCall(join(root, 'apps/api')));
    await prepare();

    expect(withinRoot(blockPaths(lastStaged(staged)))).toEqual([
      join(root, 'AGENTS.md'),
      join(root, 'apps/api/AGENTS.md'),
    ]);
  });

  it('loads nothing for an empty candidate and does not mark it seen', async () => {
    await write(join(root, 'AGENTS.md'), '');
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');
    const { producer, staged, prepare } = attemptOf();

    // The empty root file ends its chain: the nested chain still loads.
    producer.observeToolCall?.(readCall(join(root, 'apps/api/x.ts')));
    await prepare();
    const loaded = withinRoot(blockPaths(lastStaged(staged)));
    expect(loaded).toEqual([join(root, 'apps/api/AGENTS.md')]);
    expect(loaded).not.toContain(join(root, 'AGENTS.md'));

    // Being absent from the payload, the empty file stays unseen.
    const later = await realpath(join(root, 'AGENTS.md'));
    expect(seenKeys(lastStaged(staged))).not.toContain(later);
  });

  it('resolves a relative read against the root in effect for the call', async () => {
    await write(join(root, 'AGENTS.md'), 'old root rules\n');
    await write(join(root, 'apps/api/AGENTS.md'), 'old api rules\n');
    const newRoot = await mkdtemp(join(tmpdir(), 'llame-instructions-new-'));
    await write(join(newRoot, 'AGENTS.md'), 'new root rules\n');
    await write(join(newRoot, 'apps/api/AGENTS.md'), 'new api rules\n');
    try {
      const { producer, staged, prepare } = attemptOf();

      // The entry names the new root, but the same step's relative read still
      // resolves against the root in effect for its own call.
      producer.observeToolCall?.({
        toolName: enterWorkspaceTool.id,
        input: { path: newRoot },
        workspaceRoot: undefined,
        result: { status: 'success', root: newRoot, state: 'bound' },
      });
      producer.observeToolCall?.({
        toolName: 'read',
        input: { path: 'apps/api/x.ts' },
        workspaceRoot: root,
      });
      await prepare();

      const paths = blockPaths(lastStaged(staged));
      expect(paths).toContain(join(root, 'AGENTS.md'));
      expect(paths).toContain(join(root, 'apps/api/AGENTS.md'));
      expect(paths).toContain(join(newRoot, 'AGENTS.md'));
      expect(paths).not.toContain(join(newRoot, 'apps/api/AGENTS.md'));
    } finally {
      await rm(newRoot, { recursive: true, force: true });
    }
  });

  it('normalizes dot segments before resolving the touched directory', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    await write(join(root, 'apps/AGENTS.md'), 'apps rules\n');
    const { producer, staged, prepare } = attemptOf();

    // The model read the root candidate through a `..` detour: the trigger is
    // the root directory, not a directory the raw spelling passes through.
    // (`join` would normalize the path, so the literal keeps the detour.)
    producer.observeToolCall?.(readCall(`${root}/apps/../AGENTS.md`));
    await prepare();

    // Nothing loads: no `/apps` chain, and the root candidate itself is
    // excluded because the read named it.
    expect(staged).toEqual([]);

    // Excluded, not marked seen: a later touch loads the root file.
    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();
    expect(withinRoot(blockPaths(lastStaged(staged)))).toEqual([
      join(root, 'AGENTS.md'),
    ]);
  });

  it('loads the ancestors for an allowed call that fails', async () => {
    await write(join(root, 'apps/web/AGENTS.md'), 'web rules\n');
    const { producer, staged, prepare } = attemptOf();

    // A write into a directory that does not exist yet: the call fails, and
    // the trigger still loads the parents' chain from the next step.
    producer.observeToolCall?.(
      readCall(join(root, 'apps/web/src/new.tsx'), 'write'),
    );
    await prepare();

    expect(withinRoot(blockPaths(lastStaged(staged)))).toEqual([
      join(root, 'apps/web/AGENTS.md'),
    ]);
  });

  it('marks nothing for exit_workspace, or for another tool reporting a binding', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');

    for (const [toolName, result] of [
      [exitWorkspaceTool.id, { status: 'success', state: 'exited' }],
      ['search_conversations', { status: 'success', state: 'bound', root }],
      ['knowledge_search', { status: 'success', state: 'switched', root }],
    ] as const) {
      const { producer, staged, prepare } = attemptOf();

      producer.observeToolCall?.({
        toolName,
        input: {},
        workspaceRoot: root,
        result,
      });
      await prepare();

      // Only `enter_workspace` establishes a binding, so only it marks a
      // directory to walk: another tool reporting the same shape is not read
      // as one.
      expect(staged).toEqual([]);
    }
  });

  it('stays silent for a symlink whose target an earlier trigger loaded', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    await mkdir(join(root, 'apps/api'), { recursive: true });
    await symlink(join(root, 'AGENTS.md'), join(root, 'apps/api/AGENTS.md'));
    const { producer, staged, prepare } = attemptOf();

    // The first trigger loads the target under its own path.
    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();
    expect(withinRoot(blockPaths(lastStaged(staged)))).toEqual([
      join(root, 'AGENTS.md'),
    ]);

    // The link is the same file: the second trigger produces nothing new.
    producer.observeToolCall?.(readCall(join(root, 'apps/api/y.ts')));
    await prepare();
    expect(staged).toHaveLength(1);
  });

  it('re-evaluates a denied candidate on a later trigger', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    let deny = true;
    const reads: Array<string> = [];
    const readPage: ReadPage = (selectorPath) => {
      reads.push(selectorPath);
      if (deny) {
        return Promise.resolve({
          status: 'error',
          type: 'permission_denied',
          message: 'Denied by policy.',
        });
      }
      return Promise.resolve({
        status: 'success',
        kind: 'file',
        content: 'root rules\n',
        truncated: false,
      });
    };
    const { producer, staged, prepare } = attemptOf({ readPage });

    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();
    expect(staged).toEqual([]);

    // A denial is not seen, so the next trigger evaluates the candidate again.
    deny = false;
    producer.observeToolCall?.(readCall(join(root, 'y.ts')));
    await prepare();
    expect(reads).toHaveLength(2);
    expect(withinRoot(blockPaths(lastStaged(staged)))).toEqual([
      join(root, 'AGENTS.md'),
    ]);
  });
});

describe('instructions producer imports', () => {
  it('loads an imported file before its directory chain and keeps the literal marker', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const doc = join(root, 'foo/doc.md');
    const chain = join(root, 'foo/AGENTS.md');
    await write(rootFile, '@foo/doc.md\n');
    await write(doc, 'doc says @AGENTS.md\n');
    await write(chain, 'foo rules\n');

    const { producer, staged, prepare } = attemptOf();
    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();

    const part = lastStaged(staged);
    expect(blockPaths(part)).toEqual([rootFile, doc, chain]);
    const files = loadedFiles(part);
    expect(files.map((file) => file.importedBy)).toEqual([
      undefined,
      rootFile,
      undefined,
    ]);
    expect(part.data.text).toContain('@AGENTS.md');
  });

  it('loads a directly imported chain file once as an import', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const chain = join(root, 'foo/AGENTS.md');
    await write(rootFile, '@foo/AGENTS.md\n');
    await write(chain, 'foo rules\n');

    const { producer, staged, prepare } = attemptOf();
    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();

    const part = lastStaged(staged);
    expect(blockPaths(part)).toEqual([rootFile, chain]);
    expect(loadedFiles(part).map((file) => file.importedBy)).toEqual([
      undefined,
      rootFile,
    ]);
  });

  it('does not restage a directly read file targeted by an import', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const chain = join(root, 'foo/AGENTS.md');
    await write(rootFile, '@foo/AGENTS.md\n');
    await write(chain, 'foo rules\n');

    const { producer, staged, prepare } = attemptOf();
    producer.observeToolCall?.(readCall(chain));
    producer.observeToolCall?.(readCall(join(root, 'src/a.ts')));
    await prepare();

    expect(blockPaths(lastStaged(staged))).toEqual([rootFile]);
  });

  it('keeps a directly read chain file excluded when an import loads its sibling', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const doc = join(root, 'foo/doc.md');
    const chain = join(root, 'foo/AGENTS.md');
    await write(rootFile, '@foo/doc.md\n');
    await write(doc, 'doc\n');
    await write(chain, 'foo rules\n');

    const { producer, staged, prepare } = attemptOf();
    producer.observeToolCall?.(readCall(chain));
    producer.observeToolCall?.(readCall(join(root, 'src/a.ts')));
    await prepare();

    expect(blockPaths(lastStaged(staged))).toEqual([rootFile, doc]);
  });

  it('cuts a cycle without repeating either imported file', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const first = join(root, 'a.md');
    const second = join(root, 'b.md');
    await write(rootFile, '@a.md\n');
    await write(first, '@b.md\n');
    await write(second, '@a.md\n');

    const { producer, staged, prepare } = attemptOf();
    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();

    expect(blockPaths(lastStaged(staged))).toEqual([rootFile, first, second]);
  });

  it('limits an ordinary import chain to five hops', async () => {
    const rootFile = join(root, 'AGENTS.md');
    await write(rootFile, '@a.md\n');
    for (const [index, name] of ['a', 'b', 'c', 'd', 'e', 'f'].entries()) {
      await write(
        join(root, `${name}.md`),
        index === 5
          ? 'last\n'
          : `@${String.fromCharCode(name.charCodeAt(0) + 1)}.md\n`,
      );
    }

    const { producer, staged, prepare } = attemptOf();
    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();

    expect(blockPaths(lastStaged(staged))).toEqual([
      rootFile,
      ...['a', 'b', 'c', 'd', 'e'].map((name) => join(root, `${name}.md`)),
    ]);
  });

  it('consumes ordinary import hops across directories', async () => {
    const rootFile = join(root, 'AGENTS.md');
    await write(rootFile, '@a/a.md\n');
    let directory = root;
    for (const [index, name] of ['a', 'b', 'c', 'd', 'e', 'f'].entries()) {
      directory = join(directory, name);
      const next = String.fromCharCode(name.charCodeAt(0) + 1);
      await write(
        join(directory, `${name}.md`),
        index === 5 ? 'last\n' : `@${next}/${next}.md\n`,
      );
    }

    const { producer, staged, prepare } = attemptOf();
    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();

    const expected: Array<string> = [rootFile];
    let expectedDirectory = root;
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      expectedDirectory = join(expectedDirectory, name);
      expected.push(join(expectedDirectory, `${name}.md`));
    }
    expect(blockPaths(lastStaged(staged))).toEqual(expected);
    expect(lastStaged(staged).data.text).toContain('@f/f.md');
  });

  it('restarts hop counting for a chain file loaded by an import trigger', async () => {
    const rootFile = join(root, 'AGENTS.md');
    await write(rootFile, '@foo/doc.md\n');
    await write(join(root, 'foo/doc.md'), 'doc\n');
    await write(join(root, 'foo/AGENTS.md'), '@a.md\n');
    for (const [index, name] of ['a', 'b', 'c', 'd', 'e', 'f'].entries()) {
      await write(
        join(root, `foo/${name}.md`),
        index === 5
          ? 'last\n'
          : `@${String.fromCharCode(name.charCodeAt(0) + 1)}.md\n`,
      );
    }

    const { producer, staged, prepare } = attemptOf();
    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();

    expect(blockPaths(lastStaged(staged))).toEqual([
      rootFile,
      join(root, 'foo/doc.md'),
      join(root, 'foo/AGENTS.md'),
      ...['a', 'b', 'c', 'd', 'e'].map((name) => join(root, `foo/${name}.md`)),
    ]);
  });

  it('leaves missing, schemed, home, and selector targets literal', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const literalTargets = [
      join(root, '~', 'x.md'),
      join(root, 'foo.md:30-35'),
      join(root, 'https:', 'x'),
      join(root, 'kb:', 's', 'x'),
    ];
    for (const target of literalTargets) {
      await write(target, 'must stay literal\n');
    }
    await write(
      rootFile,
      '@missing.md @~/x.md @https://x @kb://s/x @foo.md:30-35\n',
    );
    const reads: Array<string> = [];
    const admitted: Array<string> = [];
    const readPage: ReadPage = async (selectorPath) => {
      reads.push(selectorPath);
      const path = selectorPath.slice(0, selectorPath.lastIndexOf(':raw:'));
      return {
        status: 'success',
        kind: 'file',
        content: await readFile(path, 'utf8'),
        truncated: false,
      };
    };
    const { producer, staged, prepare } = attemptOf({
      readPage,
      admitsRead: (path) => {
        admitted.push(path);
        return true;
      },
    });
    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();

    expect(blockPaths(lastStaged(staged))).toEqual([rootFile]);
    expect(reads).toEqual([`${rootFile}:raw:1-2000`]);
    expect(admitted).toEqual([`${join(root, 'missing.md')}:raw:1-2000`]);
    for (const target of literalTargets) {
      expect(admitted).not.toContain(target);
    }
  });
  it('resolves a host import with a trailing slash from its importer', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const targetName = `.llame-import-${root.slice(root.lastIndexOf('/') + 1)}`;
    const target = join(root, targetName);
    const decoy = join(process.cwd(), targetName);
    await write(rootFile, `@${targetName}/\n`);
    await write(target, 'the importer directory wins\n');
    await write(decoy, 'the process directory must not win\n');

    try {
      const { producer, staged, prepare } = attemptOf();
      producer.observeToolCall?.(readCall(join(root, 'x.ts')));
      await prepare();

      const part = lastStaged(staged);
      expect(blockPaths(part)).toEqual([rootFile, target]);
      expect(part.data.text).toContain('the importer directory wins');
      expect(part.data.text).not.toContain('the process directory');
      expect(deniedPaths(part)).toEqual([]);
    } finally {
      await rm(decoy, { force: true });
    }
  });

  it('keeps Knowledge imports inside their Space', async () => {
    const space = spaceOf({
      'AGENTS.md': '@notes/doc.md @../outside.md @/x.md\n',
      'notes/doc.md': 'doc\n',
      'outside.md': 'outside\n',
      '../outside.md': 'outside the Space\n',
      '/x.md': 'absolute outside the Space\n',
    });
    const { producer, staged, prepare } = attemptOf({ space });
    producer.observeToolCall?.(spaceCall('entry.md'));
    await prepare();

    expect(blockPaths(lastStaged(staged))).toEqual([
      `kb://${SPACE}/AGENTS.md`,
      `kb://${SPACE}/notes/doc.md`,
    ]);
    expect(space.reads).not.toContain(`kb://${SPACE}/outside.md:raw:1-2000`);
    expect(space.reads).not.toContain(`kb://${SPACE}/../outside.md:raw:1-2000`);
    expect(space.reads).not.toContain(`kb://${SPACE}//x.md:raw:1-2000`);
  });
  it('treats a Knowledge root key as the Space directory', async () => {
    const space = spaceOf({
      'AGENTS.md': '@.\n',
      '.': 'a dot-named file must not be imported\n',
      'Stryker was here!': 'the fallback spelling must not be imported\n',
      'Stryker%20was%20here!': 'the fallback spelling must not be imported\n',
    });
    const { producer, staged, prepare } = attemptOf({ space });
    producer.observeToolCall?.(spaceCall('entry.md'));
    await prepare();

    expect(blockPaths(lastStaged(staged))).toEqual([`kb://${SPACE}/AGENTS.md`]);
    expect(lastStaged(staged).data.text).not.toContain('dot-named file');
    expect(lastStaged(staged).data.text).not.toContain('fallback spelling');
  });

  it('does not repeat a denied Knowledge import when its marker repeats', async () => {
    const target = `kb://${SPACE}/notes/doc.md`;
    const space = spaceOf({
      'AGENTS.md': '@notes/doc.md @notes/doc.md\n',
      'notes/doc.md': 'private notes\n',
    });
    const { producer, staged, prepare } = attemptOf({
      space,
      admitsRead: (path) => path !== `${target}:raw:1-2000`,
    });
    producer.observeToolCall?.(spaceCall('entry.md'));
    await prepare();

    expect(blockPaths(lastStaged(staged))).toEqual([`kb://${SPACE}/AGENTS.md`]);
    expect(space.reads).toEqual([
      `kb://${SPACE}/AGENTS.md:raw:1-2000`,
      `${target}:raw:1-2000`,
    ]);
    expect(deniedPaths(lastStaged(staged))).toEqual([target]);
  });

  it('loads identical relative imports independently in two Knowledge Spaces', async () => {
    const first = spaceOf(
      {
        'AGENTS.md': '@notes/doc.md\n',
        'notes/doc.md': 'first space doc\n',
      },
      SPACE,
    );
    const second = spaceOf(
      {
        'AGENTS.md': '@notes/doc.md\n',
        'notes/doc.md': 'second space doc\n',
      },
      OTHER_SPACE,
    );
    const readPage: ReadPage = (selectorPath) =>
      selectorPath.startsWith(`kb://${SPACE}/`)
        ? first.readPage(selectorPath)
        : second.readPage(selectorPath);
    const knowledge: KnowledgeInstructionProbe = (spaceId) =>
      spaceId === SPACE ? first.knowledge(spaceId) : second.knowledge(spaceId);
    const { producer, staged, prepare } = attemptOf({
      space: { readPage, knowledge },
    });

    producer.observeToolCall?.(spaceCall('entry.md', 'read', SPACE));
    producer.observeToolCall?.(spaceCall('entry.md', 'read', OTHER_SPACE));
    await prepare();

    expect(blockPaths(lastStaged(staged))).toEqual([
      `kb://${SPACE}/AGENTS.md`,
      `kb://${SPACE}/notes/doc.md`,
      `kb://${OTHER_SPACE}/AGENTS.md`,
      `kb://${OTHER_SPACE}/notes/doc.md`,
    ]);
  });

  it('audits a denied import once without probing it', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const target = join(root, 'missing.md');
    await write(rootFile, '@missing.md\n');
    const reads: Array<string> = [];
    const readPage: ReadPage = async (selectorPath) => {
      reads.push(selectorPath);
      if (selectorPath.startsWith(`${target}:raw:`)) {
        return {
          status: 'error',
          type: 'permission_denied',
          message: 'Denied by policy.',
        };
      }
      const path = selectorPath.slice(0, selectorPath.lastIndexOf(':raw:'));
      return {
        status: 'success',
        kind: 'file',
        content: await readFile(path, 'utf8'),
        truncated: false,
      };
    };
    const { producer, staged, prepare } = attemptOf({
      readPage,
      admitsRead: (path) => path !== `${target}:raw:1-2000`,
    });
    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();

    expect(reads).toEqual([`${rootFile}:raw:1-2000`, `${target}:raw:1-2000`]);
    expect(deniedPaths(lastStaged(staged))).toEqual([target]);
  });

  it('audits rejected existing and missing imports identically', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const target = join(root, 'shared.md');
    await write(rootFile, '@shared.md\n');

    const load = async () => {
      const reads: Array<string> = [];
      const admitted: Array<string> = [];
      const readPage: ReadPage = async (selectorPath) => {
        reads.push(selectorPath);
        if (selectorPath.startsWith(`${target}:raw:`)) {
          return {
            status: 'error',
            type: 'permission_denied',
            message: 'Denied by policy.',
          };
        }
        const path = selectorPath.slice(0, selectorPath.lastIndexOf(':raw:'));
        return {
          status: 'success',
          kind: 'file',
          content: await readFile(path, 'utf8'),
          truncated: false,
        };
      };
      const { producer, staged, prepare } = attemptOf({
        readPage,
        admitsRead: (path) => {
          admitted.push(path);
          return path !== `${target}:raw:1-2000`;
        },
      });
      producer.observeToolCall?.(readCall(join(root, 'x.ts')));
      await prepare();
      return {
        part: lastStaged(staged),
        reads,
        admitted,
      };
    };

    await write(target, 'existing target\n');
    const existing = await load();
    await rm(target);
    const missing = await load();

    expect(existing.part.data.payload).toEqual(missing.part.data.payload);
    expect(existing.reads).toEqual([
      `${rootFile}:raw:1-2000`,
      `${target}:raw:1-2000`,
    ]);
    expect(missing.reads).toEqual(existing.reads);
    expect(existing.admitted).toEqual([`${target}:raw:1-2000`]);
    expect(missing.admitted).toEqual([`${target}:raw:1-2000`]);
  });

  it('evaluates a denied import again from a later trigger', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const nestedFile = join(root, 'nested/AGENTS.md');
    const target = join(root, 'shared.md');
    await write(rootFile, '@shared.md\n');
    await write(nestedFile, '@../shared.md\n');
    const reads: Array<string> = [];
    const readPage: ReadPage = async (selectorPath) => {
      reads.push(selectorPath);
      if (selectorPath.startsWith(`${target}:raw:`)) {
        return {
          status: 'error',
          type: 'permission_denied',
          message: 'Denied by policy.',
        };
      }
      const path = selectorPath.slice(0, selectorPath.lastIndexOf(':raw:'));
      return {
        status: 'success',
        kind: 'file',
        content: await readFile(path, 'utf8'),
        truncated: false,
      };
    };
    const attempt = attemptOf({
      readPage,
      admitsRead: (path) => path !== `${target}:raw:1-2000`,
    });
    attempt.producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await attempt.prepare();
    attempt.producer.observeToolCall?.(readCall(join(root, 'nested/x.ts')));
    await attempt.prepare();

    expect(
      reads.filter((path) => path.startsWith(`${target}:raw:`)),
    ).toHaveLength(2);
  });

  it('expands imports during an accepted-turn load', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const doc = join(root, 'foo/doc.md');
    await write(rootFile, '@foo/doc.md\n');
    await write(doc, 'doc\n');
    const part = await createInstructionsProducer().prepareTurn?.({
      runId: RUN_ID,
      workspaceRoot: root,
      readPage: pageReader().readPage,
      admitsRead: () => true,
      seenKeys: new Set(),
    });
    if (part === undefined) throw new Error('the accepted turn loaded nothing');

    expect(blockPaths(part)).toEqual([rootFile, doc]);
  });

  it('reloads imports when a fresh attempt has no seen keys', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const doc = join(root, 'foo/doc.md');
    await write(rootFile, '@foo/doc.md\n');
    await write(doc, 'doc\n');

    const first = attemptOf();
    first.producer.observeToolCall?.(readCall(join(root, 'first.ts')));
    await first.prepare();
    expect(blockPaths(lastStaged(first.staged))).toEqual([rootFile, doc]);

    const second = attemptOf({ seenKeys: new Set() });
    second.producer.observeToolCall?.(readCall(join(root, 'second.ts')));
    await second.prepare();
    expect(blockPaths(lastStaged(second.staged))).toEqual([rootFile, doc]);
  });

  it('audits a denied ancestor chain candidate once for several imports', async () => {
    const rootFile = join(root, 'CLAUDE.md');
    const denied = join(root, 'AGENTS.local.md');
    const first = join(root, 'foo/doc.md');
    const second = join(root, 'bar/doc.md');
    await write(rootFile, '@foo/doc.md @bar/doc.md\n');
    await write(denied, 'private rules\n');
    await write(first, 'foo\n');
    await write(second, 'bar\n');
    const reads: Array<string> = [];
    const readPage: ReadPage = async (selectorPath) => {
      reads.push(selectorPath);
      if (selectorPath.startsWith(`${denied}:raw:`)) {
        return {
          status: 'error',
          type: 'permission_denied',
          message: 'Denied by policy.',
        };
      }
      const path = selectorPath.slice(0, selectorPath.lastIndexOf(':raw:'));
      return {
        status: 'success',
        kind: 'file',
        content: await readFile(path, 'utf8'),
        truncated: false,
      };
    };
    const { producer, staged, prepare } = attemptOf({ readPage });
    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();

    expect(blockPaths(lastStaged(staged))).toEqual([rootFile, first, second]);
    expect(reads.filter((path) => path.startsWith(`${denied}:raw:`))).toEqual([
      `${denied}:raw:1-2000`,
    ]);
    expect(deniedPaths(lastStaged(staged))).toEqual([denied]);
  });

  it('keeps a symlinked import from suppressing its canonical chain file', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const chain = join(root, 'foo/AGENTS.md');
    const link = join(root, 'link');
    await write(rootFile, '@link/AGENTS.md\n');
    await write(chain, 'foo rules\n');
    await symlink(join(root, 'foo'), link);

    const linkFile = join(root, 'link/AGENTS.md');
    const reads: Array<readonly [string, string | undefined]> = [];
    const readPage: ReadPage = async (selectorPath, canonicalPath) => {
      reads.push([selectorPath, canonicalPath]);
      if (canonicalPath === chain) {
        return {
          status: 'error',
          type: 'permission_denied',
          message: 'Canonical path rejected.',
        };
      }
      const marker = selectorPath.lastIndexOf(':raw:');
      const path = marker < 0 ? selectorPath : selectorPath.slice(0, marker);
      return {
        status: 'success',
        kind: 'file',
        content: await readFile(path, 'utf8'),
        truncated: false,
      };
    };
    const part = await createInstructionsProducer().prepareTurn?.({
      runId: RUN_ID,
      workspaceRoot: join(root, 'foo'),
      readPage,
      admitsRead: () => true,
      seenKeys: new Set(),
    });
    if (part === undefined) throw new Error('the bound turn loaded nothing');

    expect(blockPaths(part)).toEqual([rootFile, chain]);
    expect(deniedPaths(part)).toEqual([linkFile]);
    expect(reads).toEqual([
      [`${rootFile}:raw:1-2000`, undefined],
      [`${linkFile}:raw:1-2000`, chain],
      [`${chain}:raw:1-2000`, undefined],
    ]);
  });

  it('skips a symlinked import of a file the step read directly', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const chain = join(root, 'foo/AGENTS.md');
    await write(rootFile, '@link/AGENTS.md\n');
    await write(chain, 'foo rules\n');
    await symlink(join(root, 'foo'), join(root, 'link'));
    const { producer, staged, prepare } = attemptOf();

    // The read disclosed `foo/AGENTS.md` under `foo`; the import reaches the
    // same file through `link`, so it must not be injected a second time.
    producer.observeToolCall?.(readCall(chain));
    await prepare();

    expect(blockPaths(lastStaged(staged))).toEqual([rootFile]);
  });

  it('loads a symlink target once when its import precedes the target import', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const target = join(root, 'foo/target.md');
    const link = join(root, 'foo/link.md');
    await write(rootFile, '@foo/link.md @foo/target.md\n');
    await write(target, 'target\n');
    await symlink(target, link);

    const { producer, staged, prepare } = attemptOf();
    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();

    const part = lastStaged(staged);
    expect(blockPaths(part)).toEqual([rootFile, link]);
    expect(
      loadedFiles(part).filter((file) => file.canonicalPath === target),
    ).toEqual([
      {
        path: link,
        canonicalPath: target,
        truncated: false,
        importedBy: rootFile,
      },
    ]);
    expect(deniedPaths(part)).toEqual([]);
  });

  it('audits an import with the selector used by its first page read', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const target = join(root, ':1-2');
    await write(rootFile, '@:1-2/\n');
    await write(target, 'target\n');

    const reads: Array<string> = [];
    const admitted: Array<string> = [];
    const readPage: ReadPage = async (selectorPath) => {
      reads.push(selectorPath);
      const path = selectorPath.slice(0, selectorPath.lastIndexOf(':raw:'));
      return {
        status: 'success',
        kind: 'file',
        content: await readFile(path, 'utf8'),
        truncated: false,
      };
    };
    const { producer, staged, prepare } = attemptOf({
      readPage,
      admitsRead: (path) => {
        admitted.push(path);
        return splitSelectorSuffix(path).path !== target;
      },
    });
    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();

    const part = lastStaged(staged);
    expect(blockPaths(part)).toEqual([rootFile]);
    expect(deniedPaths(part)).toEqual([target]);
    expect(admitted).toEqual([`${target}:raw:1-2000`]);
    expect(reads).toEqual([`${rootFile}:raw:1-2000`, `${target}:raw:1-2000`]);
  });

  it('loads an allowed symlinked import with its resolved label and canonical payload', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const target = join(root, 'foo/target.md');
    const link = join(root, 'foo/link.md');
    const chain = join(root, 'foo/AGENTS.md');
    await write(rootFile, '@foo/link.md\n');
    await write(target, 'target\n');
    await write(chain, 'foo rules\n');
    await symlink(target, link);
    const reader = pageReader();
    const { producer, staged, prepare } = attemptOf({
      readPage: reader.readPage,
    });

    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();

    const part = lastStaged(staged);
    expect(blockPaths(part)).toEqual([rootFile, link, chain]);
    expect(
      loadedFiles(part).map(({ path, canonicalPath, importedBy }) => ({
        path,
        canonicalPath,
        importedBy,
      })),
    ).toEqual([
      { path: rootFile, canonicalPath: rootFile, importedBy: undefined },
      { path: link, canonicalPath: target, importedBy: rootFile },
      { path: chain, canonicalPath: chain, importedBy: undefined },
    ]);
    expect(reader.canonicalPaths).toEqual([undefined, target, undefined]);
  });

  it('denies a symlinked import when its canonical target is rejected', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const target = join(root, 'foo/target.md');
    const link = join(root, 'foo/link.md');
    await write(rootFile, '@foo/link.md\n');
    await write(target, 'target\n');
    await symlink(target, link);
    const reads: Array<readonly [string, string | undefined]> = [];
    const readPage: ReadPage = async (selectorPath, canonicalPath) => {
      reads.push([selectorPath, canonicalPath]);
      if (canonicalPath === target) {
        return {
          status: 'error',
          type: 'permission_denied',
          message: 'Canonical path rejected.',
        };
      }
      const marker = selectorPath.lastIndexOf(':raw:');
      const path = marker < 0 ? selectorPath : selectorPath.slice(0, marker);
      return {
        status: 'success',
        kind: 'file',
        content: await readFile(path, 'utf8'),
        truncated: false,
      };
    };
    const { producer, staged, prepare } = attemptOf({
      readPage,
      admitsRead: () => true,
    });

    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();

    const part = lastStaged(staged);
    expect(blockPaths(part)).toEqual([rootFile]);
    expect(deniedPaths(part)).toEqual([link]);
    expect(seenKeys(part)).toEqual([rootFile]);
    expect(reads).toEqual([
      [`${rootFile}:raw:1-2000`, undefined],
      [`${link}:raw:1-2000`, target],
    ]);
  });
  it('does not deny a symlink whose canonical target was already imported', async () => {
    const rootFile = join(root, 'AGENTS.md');
    const target = join(root, 'foo/target.md');
    const link = join(root, 'foo/link.md');
    await write(rootFile, '@foo/target.md @foo/link.md\n');
    await write(target, 'target\n');
    await symlink(target, link);
    const { producer, staged, prepare } = attemptOf();

    producer.observeToolCall?.(readCall(join(root, 'x.ts')));
    await prepare();

    expect(blockPaths(lastStaged(staged))).toEqual([rootFile, target]);
    expect(deniedPaths(lastStaged(staged))).toEqual([]);
  });
});

describe('instructions producer accepted turn', () => {
  it('stages the bound root chain with a payload naming the keys it establishes', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');

    const part = await createInstructionsProducer().prepareTurn?.({
      runId: RUN_ID,
      workspaceRoot: join(root, 'apps/api'),
      readPage: pageReader().readPage,
      admitsRead: () => true,
      seenKeys: new Set(),
    });
    if (part === undefined) throw new Error('the accepted turn loaded nothing');

    const loaded = withinRoot(blockPaths(part));
    expect(loaded).toEqual([
      join(root, 'AGENTS.md'),
      join(root, 'apps/api/AGENTS.md'),
    ]);
    for (const path of loaded) expect(seenKeys(part)).toContain(path);
  });

  it('adds nothing when every root-chain file is already seen', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    const part = await createInstructionsProducer().prepareTurn?.({
      runId: RUN_ID,
      workspaceRoot: root,
      readPage: pageReader().readPage,
      admitsRead: () => true,
      seenKeys: new Set([await realpath(join(root, 'AGENTS.md'))]),
    });

    expect(part).toBeUndefined();
  });
});

describe('instructions producer accepted-turn prompt-import triggers', () => {
  function turn(input: {
    readonly workspaceRoot?: string;
    readonly hostPage?: ReadPage;
    readonly space?: {
      readonly readPage: ReadPage;
      readonly knowledge: KnowledgeInstructionProbe;
    };
    readonly triggers: ReadonlyArray<{
      readonly key: string;
      readonly space?: { readonly id: string };
    }>;
  }) {
    const { workspaceRoot, hostPage, space } = input;
    return createInstructionsProducer().prepareTurn?.({
      runId: RUN_ID,
      admitsRead: () => true,
      seenKeys: new Set(),
      promptImportTriggers: input.triggers,
      ...(workspaceRoot !== undefined && { workspaceRoot }),
      ...(hostPage !== undefined && { readPage: hostPage }),
      ...(space !== undefined && {
        knowledge: { readPage: space.readPage, probe: space.knowledge },
      }),
    });
  }

  it('loads a host import directory chain on an unbound turn', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');
    await write(join(root, 'apps/api/doc.md'), 'doc\n');
    await write(join(root, 'apps/web/AGENTS.md'), 'web rules\n');

    const part = await turn({
      hostPage: pageReader().readPage,
      triggers: [{ key: join(root, 'apps/api/doc.md') }],
    });
    if (part === undefined) throw new Error('the unbound turn loaded nothing');

    expect(withinRoot(blockPaths(part))).toEqual([
      join(root, 'AGENTS.md'),
      join(root, 'apps/api/AGENTS.md'),
    ]);
  });

  it('loads a Space chain on an unbound turn with only a Knowledge world', async () => {
    await write(join(root, 'AGENTS.md'), 'host rules\n');
    const space = spaceOf({
      'CLAUDE.md': 'space rules\n',
      'notes/AGENTS.md': 'note rules\n',
      'notes/doc.md': 'doc\n',
    });

    const part = await turn({
      space,
      triggers: [
        { key: 'notes/doc.md', space: { id: SPACE } },
        { key: join(root, 'AGENTS.md') },
      ],
    });
    if (part === undefined) throw new Error('the unbound turn loaded nothing');

    expect(blockPaths(part)).toEqual([
      `kb://${SPACE}/CLAUDE.md`,
      `kb://${SPACE}/notes/AGENTS.md`,
    ]);
  });

  it('ignores a host trigger without a page reader and a Space trigger without Knowledge', async () => {
    await write(join(root, 'AGENTS.md'), 'host rules\n');
    const hostTrigger = { key: join(root, 'doc.md') };
    const spaceTrigger = { key: 'doc.md', space: { id: SPACE } };

    expect(
      await turn({ triggers: [hostTrigger, spaceTrigger] }),
    ).toBeUndefined();
    expect(
      await turn({
        hostPage: pageReader().readPage,
        triggers: [spaceTrigger],
      }),
    ).toBeUndefined();
  });

  it('does not load an instruction file its own import names', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    const part = await turn({
      hostPage: pageReader().readPage,
      triggers: [{ key: join(root, 'AGENTS.md') }],
    });

    expect(part).toBeUndefined();
  });

  it('still loads the imported instruction file from the same turn root load', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    const part = await turn({
      workspaceRoot: root,
      hostPage: pageReader().readPage,
      triggers: [{ key: join(root, 'AGENTS.md') }],
    });
    if (part === undefined) throw new Error('the bound turn loaded nothing');

    expect(blockPaths(part)).toEqual([join(root, 'AGENTS.md')]);
  });

  it('loads the imported instruction file for a root below its directory', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    await mkdir(join(root, 'apps/api'), { recursive: true });
    const part = await turn({
      workspaceRoot: join(root, 'apps/api'),
      hostPage: pageReader().readPage,
      triggers: [{ key: join(root, 'AGENTS.md') }],
    });
    if (part === undefined) throw new Error('the bound turn loaded nothing');

    expect(blockPaths(part)).toEqual([join(root, 'AGENTS.md')]);
  });

  it('loads the imported instruction file for another import below its directory', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    await write(join(root, 'apps/api/doc.md'), 'doc\n');
    const part = await turn({
      hostPage: pageReader().readPage,
      triggers: [
        { key: join(root, 'AGENTS.md') },
        { key: join(root, 'apps/api/doc.md') },
      ],
    });
    if (part === undefined) throw new Error('the unbound turn loaded nothing');

    expect(withinRoot(blockPaths(part))).toEqual([join(root, 'AGENTS.md')]);
  });

  it('loads the root chain and a nested import chain once each, in order', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');
    await write(join(root, 'apps/api/doc.md'), 'doc\n');

    const part = await turn({
      workspaceRoot: root,
      hostPage: pageReader().readPage,
      triggers: [{ key: join(root, 'apps/api/doc.md') }],
    });
    if (part === undefined) throw new Error('the bound turn loaded nothing');

    expect(withinRoot(blockPaths(part))).toEqual([
      join(root, 'AGENTS.md'),
      join(root, 'apps/api/AGENTS.md'),
    ]);
  });
});
