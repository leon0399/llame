/**
 * Prompt imports on the host Machine through its real daemon (host-as-machine
 * D8, D12; prompt-imports "Local and Knowledge targets are silently
 * pre-evaluated before probing"): an admitted host target probes through the
 * built `llame-machine` child and reads through it, a denied target never
 * probes, and a target outside every registered root stays prose with no read.
 */

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { probeMachinePromptTarget } from '../runs/machine-prompt-probe';
import {
  daemonReadContext,
  type LocalDaemon,
  withLocalDaemon,
} from '../testing/local-daemon';
import { nativeReadTool } from '../tools/native-files';
import { renderToolResultText } from '../tools/model-text';
import { type ToolResult } from '../tools/types';
import {
  resolvePromptImports,
  type PromptImportRequest,
  type PromptImportResolution,
} from './prompt-imports';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

/** One audited read over the daemon, as the Run issues it. */
async function readThrough(
  daemon: LocalDaemon,
  path: string,
): Promise<{ result: ToolResult; text: string; admission: undefined }> {
  const context = daemonReadContext(daemon, { runId: RUN_ID });
  const result = await nativeReadTool.execute(context, { path });

  return {
    result,
    text: renderToolResultText('read', result),
    admission: undefined,
  };
}

type Harness = {
  readonly probes: Array<{ readonly name: string; readonly path: string }>;
  readonly reads: Array<string>;
  run(text: string): Promise<PromptImportResolution>;
};

/** The production ports over the running daemon, plus the calls they made. */
function harnessOf(
  daemon: LocalDaemon,
  overrides: Partial<PromptImportRequest> = {},
): Harness {
  const controller = new AbortController();
  const probes: Harness['probes'] = [];
  const reads: Array<string> = [];

  const request: PromptImportRequest = {
    text: '',
    signal: controller.signal,
    workspaceRoot: undefined,
    localMachine: daemon.name,
    defaultMachine: daemon.name,
    knowledgeAvailable: false,
    machineAvailable: true,
    sshAvailable: false,
    admitsRead: () => true,
    probeMachine: (name, path) => {
      probes.push({ name, path });

      return probeMachinePromptTarget(
        daemon.connector,
        { runId: RUN_ID, deliverySequence: 1, signal: controller.signal },
        { name, path },
      );
    },
    probeKnowledge: () => Promise.resolve(undefined),
    probeMedia: () => Promise.resolve(undefined),
    readImport: async (path) => {
      reads.push(path);

      return readThrough(daemon, path);
    },
    nowMs: () => Date.now(),
    ...overrides,
  };

  return {
    probes,
    reads,
    run: (text) => resolvePromptImports({ ...request, text }),
  };
}

describe('host prompt imports through the daemon', () => {
  it('imports an admitted file on the host Machine through its daemon', async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'prompt-imports-host-')),
    );

    try {
      const file = join(root, 'notes.md');

      await mkdir(root, { recursive: true });
      await writeFile(file, 'the host notes\n');

      await withLocalDaemon([root], async (daemon) => {
        const harness = harnessOf(daemon);
        const resolution = await harness.run(`@${file}`);

        expect(harness.probes).toEqual([{ name: daemon.name, path: file }]);
        expect(harness.reads).toEqual([daemon.locator(file)]);
        expect(resolution.outcomes).toHaveLength(1);

        const imported = resolution.outcomes[0];

        if (imported?.outcome !== 'imported') {
          throw new Error('expected an imported outcome');
        }

        expect(imported).toMatchObject({
          locator: file,
          resolved: daemon.locator(file),
        });
        // The body is native `read`'s own rendering of the file it read
        // through the daemon.
        expect(imported.body).toContain(
          `${daemon.locator(file)}:L1-1 of 1 line`,
        );
        expect(imported.body).toContain('1: the host notes');
        expect(resolution.omitted).toEqual([]);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('denies a rejected import without probing its Machine', async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'prompt-imports-denied-')),
    );

    try {
      const file = join(root, 'secret.md');

      await writeFile(file, 'do not import\n');

      await withLocalDaemon([root], async (daemon) => {
        const harness = harnessOf(daemon, { admitsRead: () => false });
        const resolution = await harness.run(`@${file}`);

        // Existence never shows: the denial runs without a probe.
        expect(harness.probes).toEqual([]);
        expect(harness.reads).toEqual([daemon.locator(file)]);
        expect(resolution.outcomes).toEqual([
          { locator: file, outcome: 'denied' },
        ]);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps literal-path precedence over a selector, as the daemon reads it', async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'prompt-imports-literal-')),
    );

    try {
      const file = join(root, 'notes.md');
      const literal = `${file}:10-12`;

      await writeFile(literal, 'the literal notes\n');
      await writeFile(file, 'the selector-free notes\n');

      await withLocalDaemon([root], async (daemon) => {
        const harness = harnessOf(daemon);
        const resolution = await harness.run(`@${literal}`);

        // The literal file exists, so it is probed as itself and the
        // selector-free path is never probed.
        expect(harness.probes).toEqual([{ name: daemon.name, path: literal }]);
        expect(harness.reads).toEqual([`${daemon.locator(file)}:10-12`]);
        expect(resolution.outcomes).toHaveLength(1);

        const imported = resolution.outcomes[0];

        if (imported?.outcome !== 'imported') {
          throw new Error('expected an imported outcome');
        }

        // The daemon reads the literal file without applying `10-12`.
        expect(imported).toMatchObject({
          locator: literal,
          resolved: daemon.locator(literal),
          literal: true,
        });
        expect(imported.body).toContain('the literal notes');
        expect(imported.body).not.toContain('the selector-free notes');
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stays prose when the import is outside the registered roots', async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'prompt-imports-outside-')),
    );

    try {
      const registered = join(root, 'repo');
      const outside = join(root, 'outside.md');

      await mkdir(registered, { recursive: true });
      await writeFile(outside, 'outside the roots\n');

      await withLocalDaemon([registered], async (daemon) => {
        const harness = harnessOf(daemon);
        const resolution = await harness.run(`@${outside}`);

        // The daemon refused the probe, so no read was issued and the marker
        // stays prose rather than importing another Machine's file.
        expect(harness.probes).toEqual([{ name: daemon.name, path: outside }]);
        expect(harness.reads).toEqual([]);
        expect(resolution.outcomes).toEqual([]);
        expect(resolution.omitted).toEqual([]);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
