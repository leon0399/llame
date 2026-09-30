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

import type { AuthoredContextItemPart } from '../chats/context-item';
import {
  isInstructionsPayload,
  instructionsSeenPaths,
} from '../chats/instructions-item';
import type { ReadPage } from './instruction-files';
import type { InRunToolCall } from '../runs/in-run-context-items';
import { enterWorkspaceTool, exitWorkspaceTool } from '../tools/workspace';
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
  const readPage: ReadPage = async (selectorPath) => {
    reads.push(selectorPath);
    const marker = selectorPath.lastIndexOf(':raw:');
    const path = marker < 0 ? selectorPath : selectorPath.slice(0, marker);
    const content = await readFile(path, 'utf8');
    return { status: 'success', kind: 'file', content, truncated: false };
  };
  return { readPage, reads };
}

/** One attempt's producer plus the items it stages at each step. */
function attemptOf(
  input: {
    readonly seenKeys?: ReadonlySet<string>;
    /** `null` builds the attempt with no page reader at all. */
    readonly readPage?: ReadPage | null;
  } = {},
) {
  const staged: Array<AuthoredContextItemPart> = [];
  const readPage =
    input.readPage === null
      ? undefined
      : (input.readPage ?? pageReader().readPage);
  const producer = createInstructionsProducer().beginAttempt({
    runId: RUN_ID,
    chatId: '22222222-2222-4222-8222-222222222222',
    userId: 'owner',
    ...(input.seenKeys !== undefined && { seenKeys: input.seenKeys }),
    ...(readPage !== undefined && { readPage }),
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
      readCall('kb://space/doc.md'),
      readCall('skill://name'),
      readCall('https://example.com/AGENTS.md'),
      readCall(join(root, 'apps/api/x.ts'), 'search_conversations'),
    ];
    const { producer, staged, prepare } = attemptOf();
    for (const call of ignored) producer.observeToolCall?.(call);
    await prepare();
    expect(staged).toEqual([]);
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

  it('marks nothing for exit_workspace', async () => {
    await write(join(root, 'AGENTS.md'), 'root rules\n');
    const { producer, staged, prepare } = attemptOf();

    producer.observeToolCall?.({
      toolName: exitWorkspaceTool.id,
      input: {},
      workspaceRoot: root,
      result: { status: 'success', state: 'exited' },
    });
    await prepare();

    expect(staged).toEqual([]);
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
