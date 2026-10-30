import { describe, expect, it } from 'vitest';

import { KnowledgeFilesystemError } from '../knowledge/knowledge-filesystem';
import type { PermissionDecision } from '../tools/permissions/types';
import { readLocatorSchemes } from '../tools/native-files';
import { type ToolResult } from '../tools/types';
import {
  MAX_PROMPT_IMPORT_BYTES,
  PROMPT_IMPORT_WORK_MS,
  resolvePromptImports,
} from './prompt-imports';

type HarnessOptions = {
  readonly workspaceRoot?: string | undefined;
  readonly hostAvailable?: boolean;
  readonly knowledgeAvailable?: boolean;
  readonly machineAvailable?: boolean;
  readonly sshAvailable?: boolean;
  /** Host paths a probe finds. */
  readonly existing?: ReadonlyArray<string>;
  /** Machine targets a probe finds, keyed `<name>` + absolute Machine path. */
  readonly machine?: Readonly<Record<string, string>>;
  /** Selector-free `kb://` locators a probe finds, with their canonical form. */
  readonly knowledge?: Readonly<Record<string, string>>;
  /** Selector-free `media://` locators the owner stores. */
  readonly media?: ReadonlyArray<string>;
  readonly reject?: (path: string) => boolean;
  readonly body?: (path: string) => string;
  readonly result?: (path: string) => ToolResult;
  readonly probeCostMs?: number;
  readonly readCostMs?: number;
  /** The admission decision a read reports. */
  readonly admission?: (path: string) => PermissionDecision | undefined;
  /** Runs as a read starts; may abort the Run mid-read. */
  readonly onRead?: (path: string, controller: AbortController) => void;
  /** Runs as a host probe starts; may abort the Run mid-probe. */
  readonly onProbe?: (controller: AbortController) => void;
  /** Overrides the Knowledge probe for cancellation and failure cases. */
  readonly probeKnowledge?: (locator: string) => Promise<string | undefined>;
  /** Overrides the Machine probe for an unreachable Machine. */
  readonly probeMachine?: (
    name: string,
    path: string,
  ) => Promise<string | undefined>;
};

const OK: ToolResult = { status: 'success', truncated: false };

function createHarness(options: HarnessOptions = {}) {
  let now = 1000;
  const calls = {
    admits: new Array<string>(),
    hostProbes: new Array<string>(),
    machineProbes: new Array<{ name: string; path: string }>(),
    knowledgeProbes: new Array<string>(),
    mediaProbes: new Array<string>(),
    reads: new Array<{ path: string; ordinal: number }>(),
    /** The entry locator each read was issued for, in read order. */
    readLocators: new Array<string>(),
  };
  const existing = new Set(options.existing ?? []);
  const controller = new AbortController();
  const run = (text: string) =>
    resolvePromptImports({
      text,
      signal: controller.signal,
      workspaceRoot: '/repo',
      hostAvailable: true,
      knowledgeAvailable: true,
      machineAvailable: true,
      sshAvailable: true,
      ...options,
      admitsRead: (path) => {
        calls.admits.push(path);
        return !(options.reject?.(path) ?? false);
      },
      probeHost: (path) => {
        calls.hostProbes.push(path);
        now += options.probeCostMs ?? 0;
        options.onProbe?.(controller);
        return Promise.resolve(existing.has(path));
      },
      probeMachine: (name, path) => {
        calls.machineProbes.push({ name, path });
        now += options.probeCostMs ?? 0;
        return (
          options.probeMachine?.(name, path) ??
          Promise.resolve(options.machine?.[`${name}${path}`])
        );
      },
      probeKnowledge: (locator) => {
        calls.knowledgeProbes.push(locator);
        now += options.probeCostMs ?? 0;
        return (
          options.probeKnowledge?.(locator) ??
          Promise.resolve(options.knowledge?.[locator])
        );
      },
      probeMedia: (locator) => {
        calls.mediaProbes.push(locator);
        now += options.probeCostMs ?? 0;
        return Promise.resolve(
          options.media?.includes(locator) === true ? locator : undefined,
        );
      },
      readImport: (path, ordinal, locator) => {
        calls.reads.push({ path, ordinal });
        calls.readLocators.push(locator);
        now += options.readCostMs ?? 0;
        options.onRead?.(path, controller);
        return Promise.resolve({
          result: options.result?.(path) ?? OK,
          text: options.body?.(path) ?? `body of ${path}`,
          admission: options.admission?.(path),
        });
      },
      nowMs: () => now,
    });
  return { calls, controller, run };
}

function tokens(count: number, make: (index: number) => string): string {
  return Array.from({ length: count }, (_, index) => `@${make(index)}`).join(
    ' ',
  );
}

describe('resolvePromptImports marker cap', () => {
  it('probes at most 64 markers and neither probes nor lists the 65th', async () => {
    const { calls, run } = createHarness();

    const result = await run(tokens(65, (index) => `f${index}.md`));

    expect(calls.hostProbes).toHaveLength(64);
    expect(calls.hostProbes).not.toContain('/repo/f64.md');
    expect(calls.admits).not.toContain('/repo/f64.md');
    expect(result).toEqual({ outcomes: [], omitted: [] });
  });

  it('lists only the 64 markers within the cap as omitted', async () => {
    const { calls, run } = createHarness();

    const result = await run(tokens(70, (index) => `https://x.test/${index}`));

    expect(calls.reads).toHaveLength(8);
    expect(result.omitted).toEqual(
      Array.from({ length: 56 }, (_, index) => `https://x.test/${index + 8}`),
    );
    expect(result.omitted).not.toContain('https://x.test/64');
  });

  it('lists nothing for nine prose tokens', async () => {
    const { calls, run } = createHarness();

    const result = await run(tokens(9, (index) => `leo${index}`));

    expect(calls.hostProbes).toHaveLength(9);
    expect(calls.reads).toEqual([]);
    expect(result).toEqual({ outcomes: [], omitted: [] });
  });

  it('keeps `ping @leo` prose when no such path exists', async () => {
    const { calls, run } = createHarness();

    const result = await run('ping @leo');

    expect(calls.admits).toEqual(['/repo/leo']);
    expect(calls.hostProbes).toEqual(['/repo/leo']);
    expect(calls.reads).toEqual([]);
    expect(result).toEqual({ outcomes: [], omitted: [] });
  });

  it('ignores an e-mail address', async () => {
    const { calls, run } = createHarness();

    const result = await run('write to leo@example.com');

    expect(calls.admits).toEqual([]);
    expect(calls.hostProbes).toEqual([]);
    expect(result).toEqual({ outcomes: [], omitted: [] });
  });
});

describe('resolvePromptImports resolution', () => {
  it('projects a relative target on the workspace and keeps its selector', async () => {
    const { calls, run } = createHarness({ existing: ['/repo/README.md'] });

    const result = await run('see @README.md:30-35');

    expect(calls.admits).toEqual(['/repo/README.md:30-35']);
    expect(calls.hostProbes).toEqual([
      '/repo/README.md:30-35',
      '/repo/README.md',
    ]);
    expect(calls.reads).toEqual([
      { path: '/repo/README.md:30-35', ordinal: 0 },
    ]);
    expect(result.outcomes).toEqual([
      {
        locator: 'README.md:30-35',
        resolved: '/repo/README.md',
        outcome: 'imported',
        body: 'body of /repo/README.md:30-35',
      },
    ]);
  });

  it('probes a literal file named like a selector as itself', async () => {
    const { calls, run } = createHarness({
      existing: ['/tmp/x.md:10-12', '/tmp/x.md'],
    });

    const result = await run('@/tmp/x.md:10-12');

    expect(calls.hostProbes).toEqual(['/tmp/x.md:10-12']);
    expect(calls.reads).toEqual([{ path: '/tmp/x.md:10-12', ordinal: 0 }]);
    expect(result.outcomes[0]).toMatchObject({
      resolved: '/tmp/x.md:10-12',
      outcome: 'imported',
    });
  });

  it('probes a selector-free path once', async () => {
    const { calls, run } = createHarness({ existing: ['/tmp/a.md'] });

    await run('@/tmp/a.md');

    expect(calls.hostProbes).toEqual(['/tmp/a.md']);
  });

  it('keeps an absolute target as written, not under the workspace', async () => {
    const { calls, run } = createHarness({ existing: ['/etc/notes.md'] });

    await run('@/etc/notes.md');

    expect(calls.admits).toEqual(['/etc/notes.md']);
    expect(calls.reads).toEqual([{ path: '/etc/notes.md', ordinal: 0 }]);
  });

  it('decodes a file alias for the probe and submits it as written', async () => {
    const { calls, run } = createHarness({ existing: ['/tmp/a b.md'] });

    const result = await run('@file:///tmp/a%20b.md');

    expect(calls.admits).toEqual(['file:///tmp/a%20b.md']);
    expect(calls.hostProbes).toEqual(['/tmp/a b.md']);
    expect(calls.reads).toEqual([{ path: 'file:///tmp/a%20b.md', ordinal: 0 }]);
    expect(result.outcomes[0]).toMatchObject({
      locator: 'file:///tmp/a%20b.md',
      resolved: '/tmp/a b.md',
    });
  });

  it('keeps a malformed file alias prose', async () => {
    const { calls, run } = createHarness();

    const result = await run('@file://remote.example/etc/a.md');

    expect(calls.admits).toEqual([]);
    expect(result).toEqual({ outcomes: [], omitted: [] });
  });

  it('probes the selector-free Knowledge locator and records its canonical form', async () => {
    const { calls, run } = createHarness({
      knowledge: { 'kb://notes/a.md': 'kb://space-1/a.md' },
    });

    const result = await run('@kb://notes/a.md:3-4');

    expect(calls.admits).toEqual(['kb://notes/a.md:3-4']);
    expect(calls.knowledgeProbes).toEqual(['kb://notes/a.md']);
    expect(calls.reads).toEqual([{ path: 'kb://notes/a.md:3-4', ordinal: 0 }]);
    expect(result.outcomes).toEqual([
      {
        locator: 'kb://notes/a.md:3-4',
        resolved: 'kb://space-1/a.md',
        outcome: 'imported',
        body: 'body of kb://notes/a.md:3-4',
      },
    ]);
  });

  it('keeps a missing admitted Knowledge target prose', async () => {
    const { calls, run } = createHarness();

    const result = await run('@kb://notes/missing.md');

    expect(calls.knowledgeProbes).toEqual(['kb://notes/missing.md']);
    expect(calls.reads).toEqual([]);
    expect(result).toEqual({ outcomes: [], omitted: [] });
  });

  it('reads skill and web targets without a pre-evaluation or probe', async () => {
    const { calls, run } = createHarness();

    const result = await run(
      '@skill://review @https://github.com/leon0399/llame/issues/1029:outline',
    );

    expect(calls.admits).toEqual([]);
    expect(calls.hostProbes).toEqual([]);
    expect(calls.knowledgeProbes).toEqual([]);
    expect(calls.reads).toEqual([
      { path: 'skill://review', ordinal: 0 },
      {
        path: 'https://github.com/leon0399/llame/issues/1029:outline',
        ordinal: 1,
      },
    ]);
    expect(result.outcomes).toHaveLength(2);
    for (const outcome of result.outcomes) {
      expect(outcome).not.toHaveProperty('resolved');
    }
  });

  it('numbers each read by the target position among distinct markers', async () => {
    const { calls, run } = createHarness();

    await run('@https://a.test/x @leo @https://b.test/y');

    expect(calls.reads.map((read) => read.ordinal)).toEqual([0, 2]);
  });

  const proseCases: Array<[string, HarnessOptions, string]> = [
    [
      'a relative target without a workspace',
      { workspaceRoot: undefined },
      'a.md',
    ],
    [
      'an absolute path without a native executor',
      { hostAvailable: false },
      '/tmp/a.md',
    ],
    [
      'a file alias without a native executor',
      { hostAvailable: false },
      'file:///tmp/a.md',
    ],
    [
      'a relative target without a native executor',
      { hostAvailable: false },
      'a.md',
    ],
    [
      'a kb target without a Knowledge root',
      { knowledgeAvailable: false },
      'kb://notes/a.md',
    ],
    ['a home path', {}, '~/a.md'],
    ['an unknown scheme', {}, 'ftp://x.test/a.md'],
  ];

  it.each(proseCases)('keeps %s prose', async (_name, options, target) => {
    const { calls, run } = createHarness({
      ...options,
      existing: ['/repo/a.md', '/tmp/a.md'],
      knowledge: { 'kb://notes/a.md': 'kb://s/a.md' },
    });

    const result = await run(`@${target}`);

    expect(calls.admits).toEqual([]);
    expect(calls.hostProbes).toEqual([]);
    expect(calls.knowledgeProbes).toEqual([]);
    expect(calls.reads).toEqual([]);
    expect(result).toEqual({ outcomes: [], omitted: [] });
  });

  it('does not follow markers inside an imported body', async () => {
    const { calls, run } = createHarness({
      existing: ['/repo/a.md'],
      body: () => 'see @b.md and @https://x.test/n',
    });

    await run('@a.md');

    expect(calls.reads).toHaveLength(1);
    expect(calls.hostProbes).toEqual(['/repo/a.md']);
  });
});

describe('resolvePromptImports Machine targets', () => {
  const MACHINE = 'machine://dev/notes/a.md';

  it('probes the Machine once and reads the canonical locator', async () => {
    const { calls, run } = createHarness({
      machine: { 'dev/notes/a.md': MACHINE },
    });

    const result = await run(`read @${MACHINE}`);

    expect(calls.admits).toEqual([MACHINE]);
    expect(calls.machineProbes).toEqual([{ name: 'dev', path: '/notes/a.md' }]);
    expect(calls.hostProbes).toEqual([]);
    expect(calls.knowledgeProbes).toEqual([]);
    expect(calls.reads).toEqual([{ path: MACHINE, ordinal: 0 }]);
    expect(calls.readLocators).toEqual([MACHINE]);
    expect(result).toEqual({
      outcomes: [
        {
          locator: MACHINE,
          resolved: MACHINE,
          outcome: 'imported',
          body: `body of ${MACHINE}`,
        },
      ],
      omitted: [],
    });
  });

  it('canonicalizes an uppercase and percent-encoded locator for the read', async () => {
    const canonical = 'machine://dev/notes/a b.md';
    const { calls, run } = createHarness({
      machine: { 'dev/notes/a b.md': canonical },
    });

    const result = await run('@Machine://Dev/notes/a%20b.md');

    expect(calls.admits).toEqual([canonical]);
    expect(calls.machineProbes).toEqual([
      { name: 'dev', path: '/notes/a b.md' },
    ]);
    expect(calls.reads).toEqual([{ path: canonical, ordinal: 0 }]);
    expect(calls.readLocators).toEqual(['Machine://Dev/notes/a%20b.md']);
    expect(result.outcomes).toEqual([
      {
        locator: 'Machine://Dev/notes/a%20b.md',
        resolved: canonical,
        outcome: 'imported',
        body: `body of ${canonical}`,
      },
    ]);
  });

  it('probes the selector-free Machine path and reads the selector-bearing locator', async () => {
    const { calls, run } = createHarness({
      machine: { 'dev/notes/a.md': MACHINE },
    });

    const result = await run(`@${MACHINE}:10-12`);

    expect(calls.admits).toEqual([`${MACHINE}:10-12`]);
    expect(calls.machineProbes).toEqual([{ name: 'dev', path: '/notes/a.md' }]);
    expect(calls.reads).toEqual([{ path: `${MACHINE}:10-12`, ordinal: 0 }]);
    expect(result.outcomes).toEqual([
      {
        locator: `${MACHINE}:10-12`,
        resolved: MACHINE,
        outcome: 'imported',
        body: `body of ${MACHINE}:10-12`,
      },
    ]);
  });

  it('projects a relative marker through a Machine Workspace root', async () => {
    const target = 'machine://dev/work/repo/notes/a.md';
    const { calls, run } = createHarness({
      workspaceRoot: 'machine://dev/work/repo',
      hostAvailable: false,
      machine: { 'dev/work/repo/notes/a.md': target },
    });

    const result = await run('see @notes/a.md');

    expect(calls.admits).toEqual([target]);
    expect(calls.machineProbes).toEqual([
      { name: 'dev', path: '/work/repo/notes/a.md' },
    ]);
    expect(calls.reads).toEqual([{ path: target, ordinal: 0 }]);
    expect(result.outcomes).toEqual([
      {
        locator: 'notes/a.md',
        resolved: target,
        outcome: 'imported',
        body: `body of ${target}`,
      },
    ]);
  });

  it('leaves a bare absolute marker on the host while the root is a Machine', async () => {
    const { calls, run } = createHarness({
      workspaceRoot: 'machine://dev/work/repo',
      existing: ['/etc/notes.md'],
    });

    await run('@/etc/notes.md');

    expect(calls.admits).toEqual(['/etc/notes.md']);
    expect(calls.hostProbes).toEqual(['/etc/notes.md']);
    expect(calls.machineProbes).toEqual([]);
  });

  it('imports a Machine marker without the local native executor', async () => {
    const { calls, run } = createHarness({
      hostAvailable: false,
      machine: { 'dev/notes/a.md': MACHINE },
    });

    const result = await run(`@${MACHINE}`);

    expect(calls.reads).toEqual([{ path: MACHINE, ordinal: 0 }]);
    expect(result.outcomes).toEqual([
      {
        locator: MACHINE,
        resolved: MACHINE,
        outcome: 'imported',
        body: `body of ${MACHINE}`,
      },
    ]);
  });

  it('keeps a target on an unreachable Machine prose', async () => {
    const { calls, run } = createHarness({
      probeMachine: () => Promise.resolve(undefined),
    });

    const result = await run(`@${MACHINE} @machine://dev/notes/missing.md`);

    expect(calls.admits).toEqual([MACHINE, 'machine://dev/notes/missing.md']);
    expect(calls.machineProbes).toEqual([
      { name: 'dev', path: '/notes/a.md' },
      { name: 'dev', path: '/notes/missing.md' },
    ]);
    expect(calls.reads).toEqual([]);
    expect(result).toEqual({ outcomes: [], omitted: [] });
  });

  it('keeps a Machine marker prose when no Machine world is available', async () => {
    const { calls, run } = createHarness({
      machineAvailable: false,
      machine: { 'dev/notes/a.md': MACHINE },
      workspaceRoot: 'machine://dev/work/repo',
    });

    const result = await run(`@${MACHINE} @notes/a.md`);

    expect(calls.admits).toEqual([]);
    expect(calls.machineProbes).toEqual([]);
    expect(calls.reads).toEqual([]);
    expect(result).toEqual({ outcomes: [], omitted: [] });
  });

  it('reads the Machine listing forms directly and keeps a refusal prose', async () => {
    const { calls, run } = createHarness({
      machine: { 'dev/notes/a.md': MACHINE },
    });

    const result = await run('@machine:// @machine://dev @machine://Dev!/x');

    expect(calls.admits).toEqual([]);
    expect(calls.machineProbes).toEqual([]);
    expect(calls.readLocators).toEqual(['machine://', 'machine://dev']);
    expect(result.outcomes.map((outcome) => outcome.locator)).toEqual([
      'machine://',
      'machine://dev',
    ]);
  });

  it('keeps the Machine listing forms prose when no Machine world is available', async () => {
    const { calls, run } = createHarness({ machineAvailable: false });

    const result = await run('@machine:// @machine://dev');

    expect(calls.reads).toEqual([]);
    expect(result).toEqual({ outcomes: [], omitted: [] });
  });

  it('records a denied Machine target without probing it', async () => {
    const { calls, run } = createHarness({
      machine: { 'dev/notes/a.md': MACHINE },
      reject: (path) => path === MACHINE,
    });

    const result = await run(`@${MACHINE}`);

    expect(calls.machineProbes).toEqual([]);
    expect(calls.reads).toEqual([{ path: MACHINE, ordinal: 0 }]);
    expect(result.outcomes).toEqual([{ locator: MACHINE, outcome: 'denied' }]);
  });
});

describe('resolvePromptImports admission', () => {
  it('reports a rejected existing and a rejected missing target identically', async () => {
    const { calls, run } = createHarness({
      existing: ['/secret/here.md'],
      reject: (path) => path.startsWith('/secret/'),
    });

    const result = await run('@/secret/here.md @/secret/gone.md');

    expect(calls.hostProbes).toEqual([]);
    expect(calls.reads).toEqual([
      { path: '/secret/here.md', ordinal: 0 },
      { path: '/secret/gone.md', ordinal: 1 },
    ]);
    expect(result.outcomes).toEqual([
      { locator: '/secret/here.md', outcome: 'denied' },
      { locator: '/secret/gone.md', outcome: 'denied' },
    ]);
  });

  it('pre-evaluates the exact selector-bearing string the read submits', async () => {
    const { calls, run } = createHarness({
      reject: (path) => path === '/repo/a.md:1-2',
    });

    const result = await run('@a.md:1-2');

    expect(calls.reads).toEqual([{ path: '/repo/a.md:1-2', ordinal: 0 }]);
    expect(result.outcomes).toEqual([
      { locator: 'a.md:1-2', outcome: 'denied' },
    ]);
  });

  it('records a denied Knowledge target without probing', async () => {
    const { calls, run } = createHarness({
      reject: () => true,
      knowledge: { 'kb://notes/a.md': 'kb://s/a.md' },
    });

    const result = await run('@kb://notes/a.md');

    expect(calls.knowledgeProbes).toEqual([]);
    expect(result.outcomes).toEqual([
      { locator: 'kb://notes/a.md', outcome: 'denied' },
    ]);
  });

  it('does not count a denied target toward the read bound', async () => {
    const { calls, run } = createHarness({
      existing: ['/repo/ok.md'],
      reject: (path) => path === '/repo/no.md',
    });

    const result = await run(
      `@no.md ${tokens(8, (index) => `https://x.test/${index}`)} @ok.md`,
    );

    expect(result.outcomes.map((outcome) => outcome.outcome)).toEqual([
      'denied',
      ...Array.from({ length: 8 }, () => 'imported'),
    ]);
    expect(result.omitted).toEqual(['ok.md']);
    expect(calls.reads).toHaveLength(9);
  });

  it('records a failed read without a body', async () => {
    const { run } = createHarness({
      existing: ['/repo/a.md'],
      result: () => ({
        status: 'error',
        type: 'not_found',
        message: 'private detail',
      }),
    });

    const result = await run('@a.md');

    expect(result.outcomes).toEqual([
      { locator: 'a.md', resolved: '/repo/a.md', outcome: 'failed' },
    ]);
  });

  it('carries read truncation to the outcome', async () => {
    const { run } = createHarness({
      result: () => ({ status: 'success', truncated: true }),
    });

    const result = await run('@https://x.test/long');

    expect(result.outcomes).toEqual([
      {
        locator: 'https://x.test/long',
        outcome: 'imported',
        body: 'body of https://x.test/long',
        truncated: true,
      },
    ]);
  });
});

describe('resolvePromptImports bounds', () => {
  it('reads 8 targets and lists later survivors and no-probe targets as omitted', async () => {
    const { calls, run } = createHarness({
      existing: ['/repo/s0.md', '/repo/s1.md', '/repo/s2.md', '/repo/s3.md'],
    });

    const result = await run(
      [
        '@s0.md @s1.md @s2.md @s3.md',
        '@https://x.test/0 @https://x.test/1 @https://x.test/2 @https://x.test/3',
        '@s4.md @missing.md @https://x.test/4 @s0.md',
      ].join(' '),
    );

    expect(calls.reads).toHaveLength(8);
    expect(result.outcomes).toHaveLength(8);
    expect(result.omitted).toEqual(['https://x.test/4']);
  });

  it('probes past the read bound so a prose token is never omitted', async () => {
    const { calls, run } = createHarness({
      existing: ['/repo/late.md'],
    });

    const result = await run(
      `${tokens(8, (index) => `https://x.test/${index}`)} @late.md @prose`,
    );

    expect(calls.hostProbes).toEqual(['/repo/late.md', '/repo/prose']);
    expect(result.omitted).toEqual(['late.md']);
  });

  it('omits a body that would exceed 128 KiB and stops reading', async () => {
    const { calls, run } = createHarness({
      body: () => 'a'.repeat(100 * 1024),
    });

    const result = await run(
      '@https://x.test/0 @https://x.test/1 @https://x.test/2',
    );

    expect(result.outcomes.map((outcome) => outcome.locator)).toEqual([
      'https://x.test/0',
    ]);
    expect(result.omitted).toEqual(['https://x.test/1', 'https://x.test/2']);
    expect(calls.reads).toHaveLength(2);
  });

  it('counts UTF-8 bytes rather than characters', async () => {
    const { run } = createHarness({
      body: () => '€'.repeat(50_000),
    });

    const result = await run('@https://x.test/0');

    expect(result.outcomes).toEqual([]);
    expect(result.omitted).toEqual(['https://x.test/0']);
  });

  it('accepts bodies that total exactly 128 KiB', async () => {
    const { run } = createHarness({
      body: () => 'a'.repeat(MAX_PROMPT_IMPORT_BYTES / 2),
    });

    const result = await run('@https://x.test/0 @https://x.test/1');

    expect(result.outcomes).toHaveLength(2);
    expect(result.omitted).toEqual([]);
  });

  it('still probes after the output bound and omits only survivors', async () => {
    const { calls, run } = createHarness({
      existing: ['/repo/late.md'],
      body: () => 'a'.repeat(MAX_PROMPT_IMPORT_BYTES + 1),
    });

    const result = await run('@https://x.test/0 @late.md @prose');

    expect(calls.hostProbes).toEqual(['/repo/late.md', '/repo/prose']);
    expect(result.omitted).toEqual(['https://x.test/0', 'late.md']);
    expect(calls.reads).toHaveLength(1);
  });

  it('drops an unprobed local target but omits a no-probe target once work is spent', async () => {
    const { calls, run } = createHarness({
      readCostMs: PROMPT_IMPORT_WORK_MS,
    });

    const result = await run(
      '@https://x.test/first @leo @https://x.test/second @/tmp/gone.md',
    );

    expect(result.outcomes.map((outcome) => outcome.locator)).toEqual([
      'https://x.test/first',
    ]);
    expect(result.omitted).toEqual(['https://x.test/second']);
    expect(calls.hostProbes).toEqual([]);
    expect(calls.admits).toEqual([]);
    expect(calls.reads).toHaveLength(1);
  });

  it('counts probes toward the work bound and omits the survivor it ends on', async () => {
    const { calls, run } = createHarness({
      existing: ['/repo/a.md'],
      probeCostMs: PROMPT_IMPORT_WORK_MS,
    });

    const result = await run('@a.md @b.md @https://x.test/0');

    expect(calls.hostProbes).toEqual(['/repo/a.md']);
    expect(calls.reads).toEqual([]);
    expect(result).toEqual({
      outcomes: [],
      omitted: ['a.md', 'https://x.test/0'],
    });
  });

  it('keeps working just under the work bound', async () => {
    const { calls, run } = createHarness({
      readCostMs: PROMPT_IMPORT_WORK_MS - 1,
    });

    const result = await run('@https://x.test/0 @https://x.test/1');

    expect(calls.reads).toHaveLength(2);
    expect(result.omitted).toEqual([]);
  });
});

const REJECT: PermissionDecision = {
  policyId: 'policy',
  decision: 'reject',
  reason: 'no_allow',
  reference: null,
};

const ALLOW: PermissionDecision = {
  policyId: 'policy',
  decision: 'allow',
  reason: 'matched_allow',
  reference: null,
};

const REFUSED: ToolResult = {
  status: 'error',
  type: 'permission_denied',
  message: 'refused',
};

describe('resolvePromptImports direct-target admission', () => {
  it('records a direct target the read group rejected as denied', async () => {
    const { run } = createHarness({
      result: (path) => (path.startsWith('skill://') ? REFUSED : OK),
      admission: (path) => (path.startsWith('skill://') ? REJECT : ALLOW),
    });

    const result = await run('@skill://hidden/SKILL.md @https://x.test/ok');

    expect(
      result.outcomes.map(({ locator, outcome }) => [locator, outcome]),
    ).toEqual([
      ['skill://hidden/SKILL.md', 'denied'],
      ['https://x.test/ok', 'imported'],
    ]);
  });

  it('records an admitted direct read that failed as failed', async () => {
    const { run } = createHarness({
      result: () => ({ status: 'error', type: 'not_found', message: 'gone' }),
      admission: () => ALLOW,
    });

    const result = await run('@https://x.test/gone');

    expect(result.outcomes).toEqual([
      { locator: 'https://x.test/gone', outcome: 'failed' },
    ]);
  });

  it('records a direct read refused before any decision as failed', async () => {
    const { run } = createHarness({ result: () => REFUSED });

    const result = await run('@https://x.test/early');

    expect(result.outcomes).toEqual([
      { locator: 'https://x.test/early', outcome: 'failed' },
    ]);
  });
});

describe('resolvePromptImports abort', () => {
  const CANCELLED: ToolResult = {
    status: 'error',
    type: 'cancelled',
    message: 'cancelled',
  };

  it('omits a read cut off by the abort and issues no further reads', async () => {
    const { calls, run } = createHarness({
      onRead: (_path, controller) => controller.abort(),
      result: () => CANCELLED,
    });

    const result = await run('@https://x.test/0 @https://x.test/1');

    expect(calls.reads).toEqual([{ path: 'https://x.test/0', ordinal: 0 }]);
    expect(result).toEqual({
      outcomes: [],
      omitted: ['https://x.test/0', 'https://x.test/1'],
    });
  });

  it('issues no read after the Run was aborted before the pass', async () => {
    const { calls, controller, run } = createHarness({
      existing: ['/repo/a.md'],
    });
    controller.abort();

    const result = await run('@a.md @https://x.test/0 @leo');

    expect(calls.reads).toEqual([]);
    expect(calls.hostProbes).toEqual([]);
    expect(calls.admits).toEqual([]);
    expect(result).toEqual({ outcomes: [], omitted: ['https://x.test/0'] });
  });

  it('omits a probe survivor when the abort lands during its probe', async () => {
    const { calls, run } = createHarness({
      existing: ['/repo/a.md'],
      onProbe: (controller) => controller.abort(),
    });

    const result = await run('@a.md @b.md');

    expect(calls.hostProbes).toEqual(['/repo/a.md']);
    expect(calls.reads).toEqual([]);
    expect(result).toEqual({ outcomes: [], omitted: ['a.md'] });
  });

  it('keeps a read that succeeded as the abort landed', async () => {
    const { calls, run } = createHarness({
      onRead: (_path, controller) => controller.abort(),
    });

    const result = await run('@https://x.test/0 @https://x.test/1');

    expect(calls.reads).toHaveLength(1);
    expect(result.outcomes.map((outcome) => outcome.locator)).toEqual([
      'https://x.test/0',
    ]);
    expect(result.omitted).toEqual(['https://x.test/1']);
  });

  it('cuts off the pass when a Knowledge probe is cancelled', async () => {
    const { calls, run } = createHarness({
      probeKnowledge: () =>
        Promise.reject(new KnowledgeFilesystemError('knowledge_cancelled')),
    });

    const result = await run(
      '@kb://notes/cancel.md @kb://notes/later.md @https://x.test/after',
    );

    expect(calls.knowledgeProbes).toEqual(['kb://notes/cancel.md']);
    expect(calls.reads).toEqual([]);
    expect(result).toEqual({
      outcomes: [],
      omitted: ['https://x.test/after'],
    });
  });
});

describe('resolvePromptImports image entries', () => {
  const MEDIA = 'media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f';
  const FOREIGN = 'media://0190f5e2-7c1a-7b3e-9d4f-00000000000b';
  /** A thumbnail near its 64 KiB cap, so counting it would close the bound. */
  const THUMBNAIL = `data:image/webp;base64,${'A'.repeat(60_000)}`;
  const UNSTORED = {
    thumbnail: THUMBNAIL,
    width: 1600,
    height: 900,
    mediaType: 'image/png',
  } as const;
  /** The native image result `read` returns for an unstored `path`. */
  const imageResult = (path: string): ToolResult => ({
    status: 'success',
    kind: 'image',
    width: UNSTORED.width,
    height: UNSTORED.height,
    mediaType: UNSTORED.mediaType,
    display: { thumbnail: THUMBNAIL },
    path,
  });
  /** The native image result `read` returns for the owner's `MEDIA`. */
  const mediaResult: ToolResult = {
    status: 'success',
    kind: 'image',
    media: MEDIA,
    mediaType: 'image/png',
    width: 1600,
    height: 900,
  };
  /** The model-facing envelope of an image result: no display data. */
  const envelope = (path: string) =>
    JSON.stringify({ ...imageResult(path), display: undefined });
  const isImage = (path: string) => path.endsWith('.png');

  it('turns an image read into an unstored image entry whose body is the read envelope', async () => {
    const { calls, run } = createHarness({
      existing: ['/repo/shot.png'],
      result: imageResult,
      body: envelope,
    });

    const result = await run('see @shot.png');

    expect(calls.reads).toEqual([{ path: '/repo/shot.png', ordinal: 0 }]);
    expect(calls.readLocators).toEqual(['shot.png']);
    expect(result.outcomes).toEqual([
      {
        locator: 'shot.png',
        resolved: '/repo/shot.png',
        outcome: 'imported',
        body: envelope('/repo/shot.png'),
        attachment: UNSTORED,
      },
    ]);
  });

  it('keeps the size and type of an image read whose thumbnail exceeded the cap', async () => {
    const { thumbnail: _thumbnail, ...original } = UNSTORED;
    const { run } = createHarness({
      existing: ['/repo/noise.png'],
      result: (path) => ({
        status: 'success',
        kind: 'image',
        ...original,
        path,
      }),
      body: envelope,
    });

    const result = await run('see @noise.png');

    expect(result.outcomes).toEqual([
      {
        locator: 'noise.png',
        resolved: '/repo/noise.png',
        outcome: 'imported',
        body: envelope('/repo/noise.png'),
        attachment: original,
      },
    ]);
  });

  it('counts an image entry toward the eight-target bound', async () => {
    const { calls, run } = createHarness({
      existing: ['/repo/shot.png'],
      result: (path) => (isImage(path) ? imageResult(path) : OK),
    });

    const result = await run(
      `@shot.png ${tokens(8, (index) => `https://x.test/${index}`)}`,
    );

    expect(calls.reads.map(({ path }) => path)).toEqual([
      '/repo/shot.png',
      ...Array.from({ length: 7 }, (_, index) => `https://x.test/${index}`),
    ]);
    expect(result.outcomes[0]).toMatchObject({ attachment: UNSTORED });
    expect(result.omitted).toEqual(['https://x.test/7']);
  });

  it('counts only the image envelope toward the output bound, never its thumbnail', async () => {
    // The envelope is all the text an image contributes; its model variant
    // and thumbnail never enter the item, however large they are.
    const { run } = createHarness({
      existing: ['/repo/shot.png'],
      result: (path) => (isImage(path) ? imageResult(path) : OK),
      body: (path) => (isImage(path) ? envelope(path) : 'a'.repeat(120 * 1024)),
    });

    const result = await run('@shot.png @https://x.test/long');

    expect(result.outcomes.map((outcome) => outcome.locator)).toEqual([
      'shot.png',
      'https://x.test/long',
    ]);
    expect(result.omitted).toEqual([]);
  });

  it('audits a denied image target without a probe or an image entry', async () => {
    const { calls, run } = createHarness({
      existing: ['/tmp/shot.png'],
      reject: (path) => path === '/tmp/shot.png',
      result: imageResult,
    });

    const result = await run('@/tmp/shot.png');

    expect(calls.hostProbes).toEqual([]);
    expect(calls.reads).toEqual([{ path: '/tmp/shot.png', ordinal: 0 }]);
    expect(result.outcomes).toEqual([
      { locator: '/tmp/shot.png', outcome: 'denied' },
    ]);
  });

  it('records an image the decode refused as not imported', async () => {
    const { run } = createHarness({
      existing: ['/repo/huge.png'],
      result: () => ({
        status: 'error',
        type: 'media_too_large',
        message: 'The image exceeds the 40-megapixel limit.',
      }),
    });

    const result = await run('@huge.png');

    expect(result.outcomes).toEqual([
      { locator: 'huge.png', resolved: '/repo/huge.png', outcome: 'failed' },
    ]);
  });

  it('probes an owned media locator and imports it as an image entry', async () => {
    const { calls, run } = createHarness({
      hostAvailable: false,
      knowledgeAvailable: false,
      media: [MEDIA],
      result: () => mediaResult,
    });

    const result = await run(`look at @${MEDIA}`);

    expect(calls.admits).toEqual([MEDIA]);
    expect(calls.mediaProbes).toEqual([MEDIA]);
    expect(calls.reads).toEqual([{ path: MEDIA, ordinal: 0 }]);
    expect(result.outcomes).toEqual([
      {
        locator: MEDIA,
        resolved: MEDIA,
        outcome: 'imported',
        body: `body of ${MEDIA}`,
        attachment: { media: MEDIA },
      },
    ]);
  });

  it('probes the selector-free media locator', async () => {
    const { calls, run } = createHarness({ media: [MEDIA] });

    await run(`@${MEDIA}:1-2`);

    expect(calls.admits).toEqual([`${MEDIA}:1-2`]);
    expect(calls.mediaProbes).toEqual([MEDIA]);
    expect(calls.reads).toEqual([{ path: `${MEDIA}:1-2`, ordinal: 0 }]);
  });

  it("keeps another owner's media locator prose", async () => {
    const { calls, run } = createHarness({ media: [MEDIA] });

    const result = await run(`@${FOREIGN}`);

    expect(calls.mediaProbes).toEqual([FOREIGN]);
    expect(calls.reads).toEqual([]);
    expect(result).toEqual({ outcomes: [], omitted: [] });
  });

  it('audits a denied media target without a lookup and never counts it', async () => {
    const { calls, run } = createHarness({
      media: [MEDIA],
      reject: (path) => path === MEDIA,
    });

    const result = await run(
      `@${MEDIA} ${tokens(8, (index) => `https://x.test/${index}`)}`,
    );

    expect(calls.mediaProbes).toEqual([]);
    expect(result.outcomes[0]).toEqual({ locator: MEDIA, outcome: 'denied' });
    expect(result.outcomes.slice(1).map((outcome) => outcome.outcome)).toEqual(
      Array.from({ length: 8 }, () => 'imported'),
    );
    expect(result.omitted).toEqual([]);
    expect(calls.reads).toHaveLength(9);
  });
});

describe('resolvePromptImports PDF entries', () => {
  const MEDIA = 'media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f';
  const pdf = {
    kind: 'pdf',
    mediaType: 'application/pdf',
    pages: 15,
    byteSize: 2 * 1024 * 1024,
  } as const;
  const result = (path: string): ToolResult => ({
    status: 'success',
    ...pdf,
    path,
    ...(path === MEDIA && { media: MEDIA }),
  });
  const envelope = (path: string) => JSON.stringify(result(path));

  it.each([
    ['paper.pdf', '/repo/paper.pdf', { existing: ['/repo/paper.pdf'] }],
    [MEDIA, MEDIA, { media: [MEDIA] }],
  ])(
    'imports %s with its exact read envelope and private PDF metadata',
    async (locator, resolved, options) => {
      const { run } = createHarness({ ...options, result, body: envelope });

      expect(await run(`@${locator}`)).toEqual({
        outcomes: [
          {
            locator,
            resolved,
            outcome: 'imported',
            body: envelope(resolved),
            attachment: { ...pdf, ...(locator === MEDIA && { media: MEDIA }) },
          },
        ],
        omitted: [],
      });
    },
  );

  it('counts a PDF toward the eight-target limit without reading the ninth target', async () => {
    const { run, calls } = createHarness({
      existing: ['/repo/paper.pdf'],
      result,
      body: envelope,
    });
    const targets = [
      'paper.pdf',
      ...Array.from({ length: 8 }, (_, i) => `https://x.test/${i}`),
    ];

    const imported = await run(targets.map((target) => `@${target}`).join(' '));

    expect(imported.outcomes.map((entry) => entry.locator)).toEqual(
      targets.slice(0, 8),
    );
    expect(imported.omitted).toEqual([targets[8]]);
    expect(calls.readLocators).toEqual(targets.slice(0, 8));
  });

  it('charges only the PDF envelope so a following text target still fits', async () => {
    const pdfPath = '/repo/paper.pdf';
    const text = 'a'.repeat(
      MAX_PROMPT_IMPORT_BYTES - Buffer.byteLength(envelope(pdfPath)),
    );
    const { run } = createHarness({
      existing: [pdfPath],
      result: (path) => (path === pdfPath ? result(path) : OK),
      body: (path) => (path === pdfPath ? envelope(path) : text),
    });

    const imported = await run('@paper.pdf @https://x.test/readme');

    expect(imported.outcomes.map((entry) => entry.outcome)).toEqual([
      'imported',
      'imported',
    ]);
    expect(imported.omitted).toEqual([]);
    expect(imported.outcomes[1]).toMatchObject({ body: text });
  });

  it('omits an oversized PDF envelope and stops further reads', async () => {
    const { run, calls } = createHarness({
      existing: ['/repo/paper.pdf'],
      result,
      body: () => 'a'.repeat(MAX_PROMPT_IMPORT_BYTES + 1),
    });

    expect(await run('@paper.pdf @https://x.test/readme')).toEqual({
      outcomes: [],
      omitted: ['paper.pdf', 'https://x.test/readme'],
    });
    expect(calls.readLocators).toEqual(['paper.pdf']);
  });
});

describe('resolvePromptImports ssh targets', () => {
  it('reads an ssh target once without a pre-evaluation or probe', async () => {
    const { calls, run } = createHarness();

    const result = await run('Explore @`ssh://root@box/opt/services`');

    expect(calls.admits).toEqual([]);
    expect(calls.hostProbes).toEqual([]);
    expect(calls.machineProbes).toEqual([]);
    expect(calls.reads).toEqual([
      { path: 'ssh://root@box/opt/services', ordinal: 0 },
    ]);
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        locator: 'ssh://root@box/opt/services',
        outcome: 'imported',
        body: 'body of ssh://root@box/opt/services',
      }),
    ]);
  });

  it('keeps an ssh target as prose without the ssh section', async () => {
    const { calls, run } = createHarness({ sshAvailable: false });

    const result = await run('@ssh://box/etc/hostname');

    expect(calls.reads).toEqual([]);
    expect(result).toEqual({ outcomes: [], omitted: [] });
  });

  it('names a denied ssh target as not imported', async () => {
    const { run } = createHarness({
      result: () => ({
        status: 'error',
        type: 'permission_denied',
        message: 'denied',
      }),
    });

    const result = await run('@ssh://box/etc/shadow');

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).not.toHaveProperty('body');
    expect(result.outcomes[0]?.outcome).not.toBe('imported');
  });
});

describe('resolvePromptImports native read schemes', () => {
  const MACHINE = 'machine://box/etc/hostname';
  const KB = 'kb://notes/a.md';
  const MEDIA = 'media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f';
  /** Probed sources need a target their probe finds; any other scheme reads directly. */
  const probed = new Map([
    ['machine', MACHINE],
    ['kb', KB],
    ['media', MEDIA],
  ]);
  const markers = readLocatorSchemes().map(
    (scheme) => probed.get(scheme) ?? `${scheme}://host/doc.md`,
  );

  it('keeps every scheme native read accepts today', () => {
    expect(readLocatorSchemes()).toEqual(
      expect.arrayContaining([
        'machine',
        'kb',
        'skill',
        'media',
        'http',
        'https',
        'ssh',
      ]),
    );
  });

  it('attempts a reachable marker of every scheme native read accepts', async () => {
    const { calls, run } = createHarness({
      machine: { 'box/etc/hostname': MACHINE },
      knowledge: { [KB]: KB },
      media: [MEDIA],
    });

    const result = await run(markers.map((marker) => `@${marker}`).join(' '));

    expect(calls.readLocators).toEqual(markers);
    expect(result.outcomes.map((outcome) => outcome.locator)).toEqual(markers);
  });

  it('keeps a scheme native read does not accept as prose', async () => {
    const { calls, run } = createHarness();

    const result = await run('@foo://host/doc.md');

    expect(calls.admits).toEqual([]);
    expect(calls.reads).toEqual([]);
    expect(result).toEqual({ outcomes: [], omitted: [] });
  });
});
