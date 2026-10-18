import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { JsonValue, NativeFailureType } from '@workspace/machine-protocol';

import {
  MAX_MACHINE_SKILL_BYTES,
  MAX_MACHINE_SKILL_REQUESTS,
  snapshotMachineSkillSources,
  type MachineSkillMethod,
  type MachineSkillRequest,
  type MachineSkillSources,
} from './machine-skill-sources';
import {
  NODE_SKILL_FILE_SYSTEM,
  SkillCatalog,
  type SkillCatalogSnapshot,
} from './skill-catalog';
import { workspaceSkillSources } from './workspace-skill-sources';

const MACHINE_ROOT = 'machine://devl/home/me/shop';

/** A scripted Machine tree: only what the fake answers from. */
type FakeNode =
  | {
      readonly kind: 'file';
      readonly text: string;
      readonly truncated?: boolean;
    }
  | {
      readonly kind: 'directory';
      readonly children: Readonly<Record<string, FakeNode>>;
      readonly truncated?: boolean;
    }
  | { readonly kind: 'link'; readonly target: FakeNode | undefined };

type FakeMachineConfig = {
  /** Thrown for every request, as an unreachable Machine does. */
  readonly failure?: Error;
  /** Answers one path with a refusal instead of the tree's value. */
  readonly refusals?: Readonly<Record<string, JsonValue>>;
  /** Answers one path with a result the snapshot must not understand. */
  readonly payloads?: Readonly<Record<string, JsonValue>>;
  /** Never answers, so only an abort can end the request. */
  readonly hang?: boolean;
};

/**
 * The Machine side of the protocol, answered from one scripted tree: `fs.list`
 * reports known kinds, `fs.read` reads through links, and `fs.stat` reports the
 * kind a link resolves to (the daemon follows the link before kinding it).
 */
class FakeMachine {
  readonly calls: Array<{
    readonly method: MachineSkillMethod;
    readonly path: string;
    readonly displayPrefix: string | undefined;
  }> = [];
  private readonly root: FakeNode;
  private readonly config: FakeMachineConfig;

  constructor(root: FakeNode, config: FakeMachineConfig = {}) {
    this.root = root;
    this.config = config;
  }

  readonly request: MachineSkillRequest = async (method, params, options) => {
    const signal = options?.signal;
    if (signal?.aborted) throw signal.reason;
    this.calls.push({
      method,
      path: params.path,
      displayPrefix:
        'options' in params ? params.options.displayPrefix : undefined,
    });
    if (this.config.hang === true && signal !== undefined) {
      return new Promise<JsonValue>((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(new Error('The scripted Machine stopped answering.')),
        );
      });
    }
    if (this.config.failure !== undefined) throw this.config.failure;
    const override =
      this.config.refusals?.[params.path] ??
      this.config.payloads?.[params.path];
    if (override !== undefined) return override;
    if (method === 'fs.list') return this.list(params.path);
    if (method === 'fs.stat') return this.stat(params.path);
    return this.read(params.path);
  };

  private list(filePath: string): JsonValue {
    const node = this.followed(filePath);
    if (node?.kind !== 'directory') {
      return refusal('not_regular_file', 'The path is not a directory.');
    }
    const entries = Object.entries(node.children).map(([name, child]) => ({
      name,
      kind: child.kind,
    }));
    return {
      entries,
      totalCount: entries.length,
      truncated: node.truncated === true,
    };
  }

  private stat(filePath: string): JsonValue {
    const node = this.at(filePath);
    if (node === undefined) return { kind: 'missing', isLink: false };
    if (node.kind !== 'link') return { kind: node.kind, isLink: false };
    const target = node.target;
    if (target === undefined) return { kind: 'missing', isLink: true };
    return {
      kind: target.kind === 'link' ? 'other' : target.kind,
      isLink: true,
    };
  }

  private read(filePath: string): JsonValue {
    const node = this.followed(filePath);
    if (node === undefined) return refusal('not_found', 'File not found.');
    if (node.kind === 'directory') {
      return {
        status: 'success',
        kind: 'directory',
        path: filePath,
        content: 'a directory listing',
        truncated: false,
      };
    }
    if (node.kind !== 'file') {
      return refusal('not_regular_file', 'The path is not a regular file.');
    }
    return {
      status: 'success',
      kind: 'file',
      path: filePath,
      content: node.text,
      truncated: node.truncated === true,
    };
  }

  /** The node at one path, following a link wherever it appears. */
  private at(filePath: string): FakeNode | undefined {
    let node: FakeNode | undefined = this.root;
    for (const segment of filePath.split('/').filter((part) => part !== '')) {
      let current: FakeNode | undefined = node;
      while (current?.kind === 'link') current = current.target;
      if (current === undefined || current.kind !== 'directory') {
        return undefined;
      }
      node = current.children[segment];
    }
    return node;
  }

  /** The node at one path, following a link in its last segment too. */
  private followed(filePath: string): FakeNode | undefined {
    let node = this.at(filePath);
    while (node?.kind === 'link') node = node.target;
    return node;
  }
}

function file(text: string, truncated = false): FakeNode {
  return { kind: 'file', text, truncated };
}

function directory(
  children: Readonly<Record<string, FakeNode>>,
  truncated = false,
): FakeNode {
  return { kind: 'directory', children, truncated };
}

function link(target?: FakeNode): FakeNode {
  return { kind: 'link', target };
}

function refusal(type: NativeFailureType, message: string): JsonValue {
  return { status: 'error', type, message };
}

function skillDocument(name: string, description = 'A skill package.'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n# Instructions\n`;
}

/** A package directory holding one valid `SKILL.md`. */
function packageNode(name: string, description?: string): FakeNode {
  return directory({ 'SKILL.md': file(skillDocument(name, description)) });
}

/** The Machine tree under `/home/me/<name>`, as a Machine source would see it. */
function shop(
  children: Readonly<Record<string, FakeNode>>,
  name = 'shop',
): FakeNode {
  return directory({
    home: directory({ me: directory({ [name]: directory(children) }) }),
  });
}

/** The `.agents/skills` source of `MACHINE_ROOT`, holding these children. */
function agentsSkills(children: Readonly<Record<string, FakeNode>>): FakeNode {
  return shop({
    '.agents': directory({ skills: directory(children) }),
  });
}

async function snapshotSkills(
  machine: FakeMachine,
  root = MACHINE_ROOT,
  options: { readonly signal?: AbortSignal; readonly budgetMs?: number } = {},
): Promise<MachineSkillSources> {
  const sources = await snapshotMachineSkillSources({
    root,
    request: machine.request,
    ...options,
  });
  if (sources === undefined) throw new Error('Expected Machine skill sources.');
  return sources;
}

function namesIn(snapshot: SkillCatalogSnapshot): Array<string> {
  return snapshot.entries.map((entry) => entry.name);
}

let temporaryDirectories: Array<string> = [];

beforeEach(() => {
  temporaryDirectories = [];
});

afterEach(() => {
  for (const temporary of temporaryDirectories) {
    rmSync(temporary, { recursive: true, force: true });
  }
});

function temporaryDirectory(label: string): string {
  const created = mkdtempSync(
    path.join(tmpdir(), `llame-machine-skills-${label}-`),
  );
  temporaryDirectories.push(created);
  return created;
}

function createHostPackage(source: string, name: string): void {
  const packageDirectory = path.join(source, name);
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(
    path.join(packageDirectory, 'SKILL.md'),
    skillDocument(name, 'A host package.'),
  );
}

describe('snapshotMachineSkillSources', () => {
  it('discovers a Machine Workspace skill and reads it through the Machine', async () => {
    const machine = new FakeMachine(
      agentsSkills({ deploy: packageNode('deploy', 'Ship the service.') }),
    );

    const sources = await snapshotSkills(machine);

    expect(sources.diagnostics).toEqual([]);
    const snapshot = new SkillCatalog([], sources.fileSystem).getSnapshot(
      workspaceSkillSources(MACHINE_ROOT),
    );
    expect(snapshot.available).toBe(true);
    expect(namesIn(snapshot)).toEqual(['deploy']);
    expect(snapshot.entries[0]).toMatchObject({
      description: 'Ship the service.',
      proactive: true,
      available: true,
      sourceDirectory: `${MACHINE_ROOT}/.agents/skills`,
      skillDirectory: `${MACHINE_ROOT}/.agents/skills/deploy`,
    });
    expect(machine.calls).toContainEqual({
      method: 'fs.list',
      path: '/home/me/shop/.agents/skills',
      displayPrefix: undefined,
    });
    expect(machine.calls).toContainEqual({
      method: 'fs.read',
      path: '/home/me/shop/.agents/skills/deploy/SKILL.md',
      displayPrefix: 'machine://devl',
    });
  });

  it('lets the highest-precedence Machine source win', async () => {
    const machine = new FakeMachine(
      shop({
        '.agents': directory({
          skills: directory({ deploy: packageNode('deploy', 'From agents.') }),
        }),
        '.llame': directory({
          skills: directory({ deploy: packageNode('deploy', 'From llame.') }),
        }),
      }),
    );

    const sources = await snapshotSkills(machine);
    const snapshot = new SkillCatalog([], sources.fileSystem).getSnapshot(
      workspaceSkillSources(MACHINE_ROOT),
    );

    expect(namesIn(snapshot)).toEqual(['deploy']);
    expect(snapshot.entries[0]).toMatchObject({
      description: 'From llame.',
      skillDirectory: `${MACHINE_ROOT}/.llame/skills/deploy`,
    });
  });

  it('publishes a linked package at its link path', async () => {
    const machine = new FakeMachine(
      agentsSkills({
        linked: link(packageNode('linked', 'Behind a link.')),
        notes: link(file('not a package')),
        broken: link(),
        'README.md': file('not a package'),
      }),
    );

    const sources = await snapshotSkills(machine);
    const snapshot = new SkillCatalog([], sources.fileSystem).getSnapshot(
      workspaceSkillSources(MACHINE_ROOT),
    );

    expect(sources.diagnostics).toEqual([]);
    expect(namesIn(snapshot)).toEqual(['broken', 'linked', 'notes']);
    expect(snapshot.entries[1]).toMatchObject({
      available: true,
      description: 'Behind a link.',
      skillDirectory: `${MACHINE_ROOT}/.agents/skills/linked`,
    });
    expect(snapshot.entries[0]).toMatchObject({
      available: false,
      diagnostics: [
        `The package symlink ${MACHINE_ROOT}/.agents/skills/broken could not be resolved.`,
      ],
    });
    expect(snapshot.entries[2]).toMatchObject({
      available: false,
      diagnostics: [
        `The package symlink ${MACHINE_ROOT}/.agents/skills/notes resolves to a regular file, not a directory.`,
      ],
    });
  });

  it('reads invocation control from the sidecars on the Machine', async () => {
    const machine = new FakeMachine(
      agentsSkills({
        manual: directory({
          'SKILL.md': file(skillDocument('manual')),
          agents: directory({
            'llame.yaml': file('policy:\n  allow_implicit_invocation: false\n'),
          }),
        }),
        openai: directory({
          'SKILL.md': file(skillDocument('openai')),
          agents: directory({
            'openai.yaml': file(
              'policy:\n  allow_implicit_invocation: false\n',
            ),
          }),
        }),
      }),
    );

    const sources = await snapshotSkills(machine);
    const snapshot = new SkillCatalog([], sources.fileSystem).getSnapshot(
      workspaceSkillSources(MACHINE_ROOT),
    );

    expect(
      snapshot.entries.map((entry) => [entry.name, entry.proactive]),
    ).toEqual([
      ['manual', false],
      ['openai', false],
    ]);
  });

  it('returns no sources for a root that is not a Machine path locator', async () => {
    const machine = new FakeMachine(
      agentsSkills({ deploy: packageNode('deploy') }),
    );

    for (const root of ['/home/me/shop', 'machine://devl', 'machine://']) {
      expect(
        await snapshotMachineSkillSources({ root, request: machine.request }),
      ).toBeUndefined();
    }
    expect(machine.calls).toEqual([]);
  });

  it('reads an unreachable Machine as an empty catalog, never a throw', async () => {
    const machine = new FakeMachine(
      agentsSkills({ deploy: packageNode('deploy') }),
      { failure: new Error('The Machine devl is unreachable.') },
    );

    const sources = await snapshotSkills(machine);

    expect(sources.diagnostics).toEqual([
      'The Machine skill snapshot failed: The Machine devl is unreachable.',
    ]);
    const catalog = new SkillCatalog([], sources.fileSystem);
    expect(() =>
      catalog.getSnapshot(workspaceSkillSources(MACHINE_ROOT)),
    ).not.toThrow();
    expect(
      catalog.getSnapshot(workspaceSkillSources(MACHINE_ROOT)),
    ).toMatchObject({ available: true, entries: [] });
  });

  it('reports a source the Machine could not list', async () => {
    const machine = new FakeMachine(
      agentsSkills({ deploy: packageNode('deploy') }),
      {
        refusals: {
          '/home/me/shop/.agents/skills': refusal(
            'executor_unavailable',
            'The directory could not be listed.',
          ),
        },
      },
    );

    const sources = await snapshotSkills(machine);

    expect(sources.diagnostics).toEqual([
      `Skill source ${MACHINE_ROOT}/.agents/skills is unreadable: The directory could not be listed.`,
    ]);
    expect(
      new SkillCatalog([], sources.fileSystem).getSnapshot(
        workspaceSkillSources(MACHINE_ROOT),
      ),
    ).toMatchObject({ entries: [] });
  });

  it('skips a source whose listing is truncated', async () => {
    const machine = new FakeMachine(
      shop({
        '.agents': directory({
          skills: directory({ deploy: packageNode('deploy') }, true),
        }),
      }),
    );

    const sources = await snapshotSkills(machine);

    expect(sources.diagnostics).toEqual([
      `Skill source ${MACHINE_ROOT}/.agents/skills exceeds 10000 children; the source is skipped.`,
    ]);
    expect(
      new SkillCatalog([], sources.fileSystem).getSnapshot(
        workspaceSkillSources(MACHINE_ROOT),
      ),
    ).toMatchObject({ entries: [] });
  });

  it('stops at the request bound and reports the sources it skipped', async () => {
    const children: Record<string, FakeNode> = {};
    for (let index = 0; index < 200; index += 1) {
      children[`skill-${index}`] = packageNode(`skill-${index}`);
    }
    const machine = new FakeMachine(agentsSkills(children));

    const sources = await snapshotSkills(machine);

    expect(machine.calls.length).toBeLessThanOrEqual(
      MAX_MACHINE_SKILL_REQUESTS,
    );
    expect(sources.diagnostics).toEqual([
      `The Machine skill snapshot reached its ${MAX_MACHINE_SKILL_REQUESTS}-request bound; the rest of the Machine Workspace's skills were skipped.`,
    ]);
    expect(
      new SkillCatalog([], sources.fileSystem).getSnapshot(
        workspaceSkillSources(MACHINE_ROOT),
      ),
    ).toMatchObject({ entries: [] });
  });

  it('stops at the byte bound', async () => {
    const children: Record<string, FakeNode> = {};
    for (let index = 0; index < 100; index += 1) {
      children[`skill-${index}`] = directory({
        'SKILL.md': file(
          `${skillDocument(`skill-${index}`)}${'x'.repeat(16_000)}`,
        ),
      });
    }
    const machine = new FakeMachine(agentsSkills(children));

    const sources = await snapshotSkills(machine);

    expect(machine.calls.length).toBeLessThan(MAX_MACHINE_SKILL_REQUESTS);
    expect(sources.diagnostics).toEqual([
      `The Machine skill snapshot reached its ${MAX_MACHINE_SKILL_BYTES}-byte bound; the rest of the Machine Workspace's skills were skipped.`,
    ]);
    expect(
      new SkillCatalog([], sources.fileSystem).getSnapshot(
        workspaceSkillSources(MACHINE_ROOT),
      ),
    ).toMatchObject({ entries: [] });
  });

  it('stops before sending anything when the caller has already aborted', async () => {
    const machine = new FakeMachine(
      agentsSkills({ deploy: packageNode('deploy') }),
    );

    const sources = await snapshotSkills(machine, MACHINE_ROOT, {
      signal: AbortSignal.abort(),
    });

    expect(machine.calls).toEqual([]);
    expect(sources.diagnostics).toEqual([
      "The Machine skill snapshot was cancelled; the rest of the Machine Workspace's skills were skipped.",
    ]);
  });

  it('stops when the snapshot runs out of time', async () => {
    const machine = new FakeMachine(
      agentsSkills({ deploy: packageNode('deploy') }),
      {
        hang: true,
      },
    );

    const sources = await snapshotSkills(machine, MACHINE_ROOT, {
      budgetMs: 5,
    });

    expect(sources.diagnostics).toEqual([
      "The Machine skill snapshot was cancelled; the rest of the Machine Workspace's skills were skipped.",
    ]);
    expect(
      new SkillCatalog([], sources.fileSystem).getSnapshot(
        workspaceSkillSources(MACHINE_ROOT),
      ),
    ).toMatchObject({ entries: [] });
  });

  it('stops at a result it cannot read', async () => {
    const machine = new FakeMachine(
      agentsSkills({ deploy: packageNode('deploy') }),
      { payloads: { '/home/me/shop/.agents/skills': {} } },
    );

    const sources = await snapshotSkills(machine);

    expect(sources.diagnostics).toEqual([
      `The Machine skill snapshot read an unreadable result at ${MACHINE_ROOT}/.agents/skills`,
    ]);
    expect(
      new SkillCatalog([], sources.fileSystem).getSnapshot(
        workspaceSkillSources(MACHINE_ROOT),
      ),
    ).toMatchObject({ entries: [] });
  });

  it('stops when a document read answers with something else entirely', async () => {
    const machine = new FakeMachine(
      agentsSkills({ deploy: packageNode('deploy') }),
      { payloads: { '/home/me/shop/.agents/skills/deploy/SKILL.md': 7 } },
    );

    const sources = await snapshotSkills(machine);

    expect(sources.diagnostics).toEqual([
      `The Machine skill snapshot read an unreadable result at ${MACHINE_ROOT}/.agents/skills/deploy/SKILL.md`,
    ]);
    expect(
      new SkillCatalog([], sources.fileSystem).getSnapshot(
        workspaceSkillSources(MACHINE_ROOT),
      ),
    ).toMatchObject({ entries: [] });
  });

  it('stops when a link cannot be resolved', async () => {
    const machine = new FakeMachine(
      agentsSkills({ linked: link(packageNode('linked')) }),
      { payloads: { '/home/me/shop/.agents/skills/linked': {} } },
    );

    const sources = await snapshotSkills(machine);

    expect(sources.diagnostics).toEqual([
      `The Machine skill snapshot read an unreadable result at ${MACHINE_ROOT}/.agents/skills/linked`,
    ]);
    expect(
      new SkillCatalog([], sources.fileSystem).getSnapshot(
        workspaceSkillSources(MACHINE_ROOT),
      ),
    ).toMatchObject({ entries: [] });
  });

  it('never treats a bounded or refused document read as the package', async () => {
    const machine = new FakeMachine(
      agentsSkills({
        huge: directory({
          'SKILL.md': file(skillDocument('huge'), true),
        }),
        opaque: directory({ 'SKILL.md': file(skillDocument('opaque')) }),
      }),
      {
        refusals: {
          '/home/me/shop/.agents/skills/opaque/SKILL.md': refusal(
            'invalid_utf8',
            'The file is not valid UTF-8.',
          ),
        },
      },
    );

    const sources = await snapshotSkills(machine);
    const snapshot = new SkillCatalog([], sources.fileSystem).getSnapshot(
      workspaceSkillSources(MACHINE_ROOT),
    );

    expect(
      snapshot.entries.map((entry) => [entry.name, entry.available]),
    ).toEqual([
      ['huge', false],
      ['opaque', false],
    ]);
    expect(snapshot.entries[0].diagnostics).toEqual([
      'SKILL.md could not be read.',
    ]);
    expect(snapshot.entries[1].diagnostics).toEqual([
      'SKILL.md could not be read.',
    ]);
  });

  it('never reads a skill document that is itself a directory', async () => {
    const machine = new FakeMachine(
      agentsSkills({ odd: directory({ 'SKILL.md': directory({}) }) }),
    );

    const sources = await snapshotSkills(machine);
    const snapshot = new SkillCatalog([], sources.fileSystem).getSnapshot(
      workspaceSkillSources(MACHINE_ROOT),
    );

    expect(snapshot.entries).toMatchObject([
      {
        name: 'odd',
        available: false,
        diagnostics: ['SKILL.md is not a readable regular file.'],
      },
    ]);
  });

  it('treats a media result for a skill document as an unavailable package', async () => {
    const machine = new FakeMachine(
      agentsSkills({ picture: directory({ 'SKILL.md': file('') }) }),
      {
        payloads: {
          '/home/me/shop/.agents/skills/picture/SKILL.md': {
            status: 'success',
            kind: 'image',
            mediaType: 'image/png',
            path: 'machine://devl/home/me/shop/.agents/skills/picture/SKILL.md',
          },
        },
      },
    );

    const sources = await snapshotSkills(machine);
    const snapshot = new SkillCatalog([], sources.fileSystem).getSnapshot(
      workspaceSkillSources(MACHINE_ROOT),
    );

    expect(snapshot.entries).toMatchObject([
      {
        name: 'picture',
        available: false,
        diagnostics: ['SKILL.md is not a readable regular file.'],
      },
    ]);
  });

  it('delegates every non-Machine key to the host file system', async () => {
    const host = temporaryDirectory('host');
    createHostPackage(host, 'host-skill');
    const machine = new FakeMachine(
      agentsSkills({ deploy: packageNode('deploy') }),
    );
    const sources = await snapshotSkills(machine);

    const reads = vi.spyOn(NODE_SKILL_FILE_SYSTEM, 'readTextFile');
    try {
      const snapshot = new SkillCatalog([host], sources.fileSystem).getSnapshot(
        workspaceSkillSources(MACHINE_ROOT),
      );

      expect(namesIn(snapshot)).toEqual(['deploy', 'host-skill']);
      expect(reads).toHaveBeenCalledWith(
        path.join(host, 'host-skill', 'SKILL.md'),
      );
    } finally {
      reads.mockRestore();
    }
    expect(sources.fileSystem.fileKind(path.join(host, 'missing'))).toBe(
      'missing',
    );
    expect(() =>
      sources.fileSystem.readDirectory(path.join(host, 'missing')),
    ).toThrow('ENOENT');
  });

  it('answers a Machine path it never snapshotted honestly', async () => {
    const machine = new FakeMachine(
      agentsSkills({ deploy: packageNode('deploy') }),
    );
    const sources = await snapshotSkills(machine);

    expect(
      sources.fileSystem.fileKind('machine://devl/elsewhere/SKILL.md'),
    ).toBe('unavailable');
    expect(() =>
      sources.fileSystem.readTextFile('machine://devl/elsewhere/SKILL.md'),
    ).toThrow('The Machine skill snapshot holds no text');
    expect(() =>
      sources.fileSystem.readDirectory('machine://devl/elsewhere/skills'),
    ).toThrow('The Machine skill source machine://devl/elsewhere/skills');
    expect(() => sources.fileSystem.readDirectory('machine://devl')).toThrow(
      'The Machine skill source machine://devl',
    );
  });

  it('answers the spellings path.join leaves behind', async () => {
    const machine = new FakeMachine(
      shop(
        {
          '.agents': directory({
            skills: directory({ deploy: packageNode('deploy') }),
          }),
        },
        'my shop',
      ),
    );
    const root = 'machine://devl/home/me/my shop';
    const sources = await snapshotSkills(machine, root);

    // `path.join` collapses the scheme's `//`; the catalog joins children onto
    // whatever spelling it was handed, so both must resolve.
    const collapsed = workspaceSkillSources(root).map((source) =>
      path.join(source),
    );
    const raw = [
      'machine://devl/home/me/my shop/.agents/skills',
      'machine://devl/home/me/my shop/.claude/skills',
      'machine://devl/home/me/my shop/.llame/skills',
    ];

    for (const spellings of [collapsed, raw]) {
      const snapshot = new SkillCatalog([], sources.fileSystem).getSnapshot(
        spellings,
      );
      expect(namesIn(snapshot)).toEqual(['deploy']);
      expect(snapshot.entries[0].available).toBe(true);
    }
    expect(machine.calls).toContainEqual({
      method: 'fs.read',
      path: '/home/me/my shop/.agents/skills/deploy/SKILL.md',
      displayPrefix: 'machine://devl',
    });
  });
});
