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
import type {
  InRunAttemptProducer,
  InRunReadPage,
  InRunToolCall,
} from '../runs/in-run-context-items';
import { enterWorkspaceTool } from '../tools/workspace';
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

/** A page reader over real files, plus the selectors it was asked for. */
interface PageReaderFixture {
  readonly readPage: InRunReadPage;
  readonly reads: Array<string>;
}

/** One attempt's producer, plus the items each step staged. */
interface AttemptFixture {
  readonly producer: InRunAttemptProducer;
  readonly staged: Array<AuthoredContextItemPart>;
  readonly prepare: () => Promise<void>;
}

/** A page reader over the real files, recording every selector it was asked for. */
function pageReader(): PageReaderFixture {
  const reads: Array<string> = [];
  const readPage: InRunReadPage = async (selectorPath) => {
    reads.push(selectorPath);
    const marker = selectorPath.lastIndexOf(':raw:');
    const path = marker < 0 ? selectorPath : selectorPath.slice(0, marker);
    const content = await readFile(path, 'utf8');
    return { status: 'success', kind: 'file', content, truncated: false };
  };
  return { readPage, reads };
}

/** One attempt's producer plus the items it stages at each step. */
function attemptOf(input: {
  readonly seenKeys?: ReadonlyArray<string>;
  readonly readPage?: InRunReadPage;
}): AttemptFixture {
  const staged: Array<AuthoredContextItemPart> = [];
  const producer = createInstructionsProducer().beginAttempt({
    runId: RUN_ID,
    chatId: '22222222-2222-4222-8222-222222222222',
    userId: 'owner',
    ...(input.seenKeys !== undefined && { seenKeys: input.seenKeys }),
    ...(input.readPage !== undefined && { readPage: input.readPage }),
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
    const { producer, staged, prepare } = attemptOf({
      readPage: pageReader().readPage,
    });

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
      const { producer, staged, prepare } = attemptOf({
        readPage: pageReader().readPage,
      });
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

    const relative = attemptOf({ readPage: pageReader().readPage });
    relative.producer.observeToolCall?.({
      toolName: 'read',
      input: { path: 'apps/api/src/x.ts' },
      workspaceRoot: root,
    });
    await relative.prepare();
    expect(withinRoot(blockPaths(lastStaged(relative.staged)))).toEqual([
      join(root, 'apps/api/AGENTS.md'),
    ]);

    const aliased = attemptOf({ readPage: pageReader().readPage });
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
      const { producer, staged, prepare } = attemptOf({
        readPage: pageReader().readPage,
      });
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
    const { producer, staged, prepare } = attemptOf({
      readPage: pageReader().readPage,
    });
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
      const { producer, staged, prepare } = attemptOf({
        readPage: pageReader().readPage,
      });
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
    const { producer, staged, prepare } = attemptOf({
      readPage: pageReader().readPage,
    });

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
      seenKeys: [canonical],
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
    const { producer, staged, prepare } = attemptOf({
      readPage: pageReader().readPage,
    });

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

  it('loads nothing for a denied call and nothing without a page reader', async () => {
    await write(join(root, 'apps/api/AGENTS.md'), 'api rules\n');
    const denied = attemptOf({ readPage: pageReader().readPage });
    denied.producer.observeToolCall?.({
      ...readCall(join(root, 'apps/api/x.ts')),
      result: {
        status: 'error',
        type: 'permission_denied',
        message: 'Denied by policy.',
      },
    });
    await denied.prepare();
    expect(denied.staged).toEqual([]);

    // The read gate: no page reader means no trigger can load anything.
    const gated = attemptOf({});
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
    const { producer, staged, prepare } = attemptOf({
      readPage: pageReader().readPage,
    });

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
    const { producer, staged, prepare } = attemptOf({
      readPage: pageReader().readPage,
    });

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
    const { producer, staged, prepare } = attemptOf({
      readPage: pageReader().readPage,
    });

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
});
