import { describe, expect, it } from 'vitest';

import type { PermissionDecision } from '../tools/permissions/types';
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
  /** Host paths a probe finds. */
  readonly existing?: ReadonlyArray<string>;
  /** Selector-free `kb://` locators a probe finds, with their canonical form. */
  readonly knowledge?: Readonly<Record<string, string>>;
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
};

const OK: ToolResult = { status: 'success', truncated: false };

function createHarness(options: HarnessOptions = {}) {
  let now = 1000;
  const calls = {
    admits: new Array<string>(),
    hostProbes: new Array<string>(),
    knowledgeProbes: new Array<string>(),
    reads: new Array<{ path: string; ordinal: number }>(),
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
      probeKnowledge: (locator) => {
        calls.knowledgeProbes.push(locator);
        now += options.probeCostMs ?? 0;
        return Promise.resolve(options.knowledge?.[locator]);
      },
      readImport: (path, ordinal) => {
        calls.reads.push({ path, ordinal });
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
});
