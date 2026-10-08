import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { activateSkills } from './skill-activation';
import { parseSkillMentions } from './skill-mention';
import { SkillCatalog } from './skill-catalog';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { compileToolPermissionMap } from '../tools/permissions/compile-permissions';
import { nativeReadTool } from '../tools/native-files';
import { type PermissionDecision } from '../tools/permissions/types';
import { type ToolContext, type ToolResult } from '../tools/types';

const RUN_ID = '11111111-2222-4333-8444-555555555555';

type AuditRecord = {
  readonly toolCallId: string;
  readonly phase: 'requested' | 'completed';
  readonly decision?: PermissionDecision;
  readonly result?: ToolResult;
};

let source: string;
let temporaryDirectories: Array<string>;

beforeEach(() => {
  temporaryDirectories = [];
  source = mkdtempSync(path.join(tmpdir(), 'llame-skill-imports-'));
  temporaryDirectories.push(source);
});

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createPackage(name: string, body: string): string {
  const directory = path.join(source, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name}\n---\n${body}`,
  );
  return directory;
}

function harness(policy = compileTestPermissionPolicy()) {
  const audit: Array<AuditRecord> = [];
  const context: ToolContext = {
    userId: 'owner',
    chatId: 'chat',
    runId: RUN_ID,
    permissionPolicy: policy,
    skillCatalog: new SkillCatalog([source]),
    timeoutMs: 5000,
    tenantDb: { runAs: () => Promise.reject(new Error('no database in test')) },
  };
  return {
    audit,
    context,
    activity: {
      admitted: (toolCallId: string, decision: PermissionDecision) => {
        audit.push({ toolCallId, phase: 'requested', decision });
      },
      completed: (toolCallId: string, result: ToolResult) => {
        audit.push({ toolCallId, phase: 'completed', result });
      },
    },
  };
}

function run(text: string, policy = compileTestPermissionPolicy()) {
  const h = harness(policy);
  return activateSkills({
    mentions: parseSkillMentions(text),
    runId: RUN_ID,
    readTool: nativeReadTool,
    toolContext: h.context,
    callTimeoutSeconds: 5,
    activity: h.activity,
  }).then((outcome) => ({ ...h, outcome }));
}

function itemText(item: { readonly data: { readonly text?: string } }): string {
  return item.data.text ?? '';
}

describe('activated package imports', () => {
  it('loads a reference and nested imports depth first', async () => {
    const directory = createPackage(
      'research',
      'Use @references/checklist.md.\n',
    );
    mkdirSync(path.join(directory, 'references'));
    writeFileSync(
      path.join(directory, 'references', 'checklist.md'),
      'Checklist: @a.md\n',
    );
    writeFileSync(path.join(directory, 'references', 'a.md'), 'Nested A.\n');

    const { outcome, audit } = await run('$research');
    const text = itemText(outcome.items[0]);
    expect(
      text.indexOf('skill://research/references/checklist.md'),
    ).toBeLessThan(text.indexOf('skill://research/references/a.md'));
    expect(outcome.items[0].data.payload).toMatchObject({
      imports: [
        'skill://research/references/checklist.md',
        'skill://research/references/a.md',
      ],
    });
    expect(
      audit
        .filter((record) => record.phase === 'requested')
        .map((record) => record.toolCallId),
    ).toEqual([
      `skill-activation-${RUN_ID}-0`,
      `skill-activation-${RUN_ID}-0-0`,
      `skill-activation-${RUN_ID}-0-1`,
    ]);
  });

  it('leaves non-package and selector targets literal without reading them', async () => {
    createPackage(
      'research',
      '@../other/SKILL.md @/etc/x @~/x @https://x @a.md:1-2\n',
    );

    const { outcome, audit } = await run('$research');
    expect(itemText(outcome.items[0])).toContain('@../other/SKILL.md');
    expect(audit.filter((record) => record.phase === 'requested')).toHaveLength(
      1,
    );
  });

  it('silently skips a denied import while recording its audited read', async () => {
    createPackage('research', 'Body @secret.md\n');
    writeFileSync(path.join(source, 'research', 'secret.md'), 'private\n');
    const policy = compileToolPermissionMap(
      {
        read: {
          allow: true,
          reject: [{ field: 'path', literal: 'skill://research/secret.md' }],
        },
      },
      'reject-secret',
    );

    const { outcome, audit } = await run('$research', policy);
    expect(itemText(outcome.items[0])).toContain('@secret.md');
    expect(outcome.items[0].data.payload).not.toHaveProperty('imports');
    expect(audit).toHaveLength(4);
    expect(audit[2].decision).toMatchObject({ decision: 'reject' });
    expect(audit[3].result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
  });
  it('loads each cycle member once and stops after five hops', async () => {
    const directory = createPackage('research', '@a.md @c.md');
    for (const [name, body] of [
      ['a.md', '@b.md'],
      ['b.md', '@a.md'],
      ['c.md', '@d.md'],
      ['d.md', '@e.md'],
      ['e.md', '@f.md'],
      ['f.md', '@g.md'],
      ['g.md', '@h.md'],
      ['h.md', 'sixth'],
    ]) {
      writeFileSync(path.join(directory, name), body);
    }

    const cycle = await run('$research');
    expect(cycle.outcome.items[0].data.payload).toMatchObject({
      imports: [
        'skill://research/a.md',
        'skill://research/b.md',
        'skill://research/c.md',
        'skill://research/d.md',
        'skill://research/e.md',
        'skill://research/f.md',
        'skill://research/g.md',
      ],
    });
    expect(
      cycle.audit.filter((record) => record.phase === 'requested'),
    ).toHaveLength(8);
    expect(itemText(cycle.outcome.items[0])).not.toContain(
      'skill://research/h.md',
    );
  });

  it('names imports omitted after the aggregate output bound', async () => {
    const directory = createPackage(
      'research',
      Array.from({ length: 10 }, (_, index) => `@part-${index}.md`).join(' '),
    );
    const large = 'x\n'.repeat(20_000);
    for (let index = 0; index < 10; index += 1) {
      writeFileSync(path.join(directory, `part-${index}.md`), large);
    }

    const { outcome } = await run('$research');
    const omission = outcome.items.find(
      (item) => item.data.payload['kind'] === 'omission',
    );
    expect(omission).toBeDefined();
    if (omission === undefined) return;
    const imports = omission.data.payload['imports'];
    expect(Array.isArray(imports)).toBe(true);
    if (!Array.isArray(imports)) return;
    expect(imports.length).toBeGreaterThan(0);
  });

  it('does not reread a completed activation during recovery', async () => {
    const directory = createPackage('research', '@checklist.md\n');
    writeFileSync(path.join(directory, 'checklist.md'), 'Checklist.\n');
    const first = await run('$research');
    expect(
      first.audit.filter((record) => record.phase === 'requested'),
    ).toHaveLength(2);

    const retry = harness();
    const outcome = await activateSkills({
      mentions: parseSkillMentions('$research'),
      runId: RUN_ID,
      readTool: nativeReadTool,
      toolContext: retry.context,
      callTimeoutSeconds: 5,
      activity: retry.activity,
      resolved: new Set(['research']),
    });
    expect(retry.audit).toEqual([]);
    expect(outcome.items).toEqual([]);
  });
});
