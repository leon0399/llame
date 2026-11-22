/**
 * Host instruction files through the host Machine's real daemon (host-as-
 * machine design D8, D12; instruction-files "A Machine-path trigger loads the
 * chain from the containing registered root"): the accepted-turn and entry
 * chains, the file-touch ancestors, and the registered-root stop are walked
 * with `fs.stat`/`fs.list` answers from the built `llame-machine` child, and
 * every page is read through the daemon too. The root registered with the
 * daemon's own `roots add` bounds each chain.
 */

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AuthoredContextItemPart } from '../chats/context-item';
import { isInstructionsPayload } from '../chats/instructions-item';
import { machineEnvelope } from '../runs/machine-attempt';
import { type InRunToolCall } from '../runs/in-run-context-items';
import {
  daemonReadContext,
  type LocalDaemon,
  withLocalDaemon,
} from '../testing/local-daemon';
import { nativeReadTool } from '../tools/native-files';
import { type ReadPage } from './instruction-files';
import { createInstructionsProducer } from './instructions-producer';
import { createMachineInstructionProbe } from './machine-instruction-scope';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

/** A fresh directory every test creates its tree under, then removes. */
async function temporaryBase(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'instructions-host-')));
}

/** One attempt over the running daemon: the production probe and page reader. */
function attemptOf(daemon: LocalDaemon) {
  const staged: Array<AuthoredContextItemPart> = [];
  const context = daemonReadContext(daemon);

  const readPage: ReadPage = async (selectorPath) =>
    await nativeReadTool.execute(context, { path: selectorPath });

  const producer = createInstructionsProducer().beginAttempt({
    runId: RUN_ID,
    chatId: '22222222-2222-4222-8222-222222222222',
    userId: 'owner',
    admitsRead: () => true,
    localMachine: daemon.name,
    defaultMachine: daemon.name,
    machines: {
      probe: createMachineInstructionProbe({
        connector: daemon.connector,
        envelope: machineEnvelope({ runId: RUN_ID, deliverySequence: 1 }),
      }),
      readPage,
    },
  });

  return {
    producer,
    staged,
    async prepare() {
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

/** The selected locators an item discloses, in block order. */
function blockPaths(part: AuthoredContextItemPart): Array<string> {
  const payload = part.data.payload;

  if (!isInstructionsPayload(payload)) {
    throw new Error('the staged part is not an instructions payload');
  }

  return payload.files.map((file) => file.path);
}

/** One settled `enter_workspace` that bound `root`. */
function entryCall(root: string): InRunToolCall {
  return {
    toolName: 'enter_workspace',
    input: { path: root },
    result: { status: 'success', root, state: 'bound' },
    workspaceRoot: undefined,
  };
}

/** One admitted native `read` of a Machine locator. */
function readCall(path: string, workspaceRoot?: string): InRunToolCall {
  return { toolName: 'read', input: { path }, workspaceRoot };
}

/** Write one file below `root`, creating its parent directories. */
async function writeAt(
  root: string,
  relative: string,
  content: string,
): Promise<void> {
  const target = join(root, ...relative.split('/'));

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

describe('host instruction files through the daemon', () => {
  it('loads the entered chain from the containing registered root', async () => {
    const base = await temporaryBase();

    try {
      await writeAt(base, 'repo/AGENTS.md', 'repo rules\n');
      await writeAt(base, 'repo/apps/api/AGENTS.md', 'api rules\n');

      await withLocalDaemon([base], async (daemon) => {
        const attempt = attemptOf(daemon);
        const root = daemon.locator(join(base, 'repo', 'apps', 'api'));

        attempt.producer.observeToolCall?.(entryCall(root));
        await attempt.prepare();

        expect(attempt.staged).not.toEqual([]);
        expect(blockPaths(attempt.staged[0])).toEqual([
          daemon.locator(join(base, 'repo', 'AGENTS.md')),
          daemon.locator(join(base, 'repo', 'apps', 'api', 'AGENTS.md')),
        ]);
      });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('a host chain stops at the registered root', async () => {
    const base = await temporaryBase();

    try {
      await writeAt(base, 'AGENTS.md', 'above the root rules\n');
      await writeAt(base, 'repo/AGENTS.md', 'inside the root rules\n');

      // Only `/repo` is registered: the chain may not read the file above it.
      await withLocalDaemon([join(base, 'repo')], async (daemon) => {
        const attempt = attemptOf(daemon);

        attempt.producer.observeToolCall?.(
          entryCall(daemon.locator(join(base, 'repo'))),
        );
        await attempt.prepare();

        const loaded = attempt.staged.flatMap(blockPaths);

        expect(loaded).toEqual([
          daemon.locator(join(base, 'repo', 'AGENTS.md')),
        ]);
        expect(loaded).not.toContain(daemon.locator(join(base, 'AGENTS.md')));
      });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('walks a touched file’s ancestors inside the registered root', async () => {
    const base = await temporaryBase();

    try {
      await writeAt(base, 'other/AGENTS.md', 'other rules\n');
      await writeAt(base, 'other/src/x.ts', 'export const x = 1;\n');
      await writeAt(base, 'repo/AGENTS.md', 'repo rules\n');

      await withLocalDaemon([base], async (daemon) => {
        const attempt = attemptOf(daemon);
        const workspace = daemon.locator(join(base, 'repo'));

        attempt.producer.observeToolCall?.(
          readCall(
            daemon.locator(join(base, 'other', 'src', 'x.ts')),
            workspace,
          ),
        );
        await attempt.prepare();

        // The file is outside the Workspace but inside the registered root,
        // and the Workspace root's own file was already loaded.
        expect(blockPaths(attempt.staged[0])).toEqual([
          daemon.locator(join(base, 'other', 'AGENTS.md')),
        ]);
      });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('reads nothing when no registered root contains the target', async () => {
    const base = await temporaryBase();

    try {
      await writeAt(base, 'repo/AGENTS.md', 'repo rules\n');
      await writeAt(base, 'other/AGENTS.md', 'other rules\n');
      await writeAt(base, 'other/x.ts', 'export const x = 1;\n');

      await withLocalDaemon([join(base, 'repo')], async (daemon) => {
        const attempt = attemptOf(daemon);

        attempt.producer.observeToolCall?.(
          readCall(daemon.locator(join(base, 'other', 'x.ts'))),
        );
        await attempt.prepare();

        expect(attempt.staged).toEqual([]);
      });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
