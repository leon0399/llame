import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  MAX_SKILL_SOURCES,
  MAX_SOURCE_CHILDREN,
  NODE_SKILL_FILE_SYSTEM,
  SkillCatalog,
  type CatalogDirent,
  type SkillCatalogEntry,
  type SkillCatalogFileSystem,
  type SkillCatalogSnapshot,
} from './skill-catalog';

let temporaryDirectories: Array<string> = [];

beforeEach(() => {
  temporaryDirectories = [];
});

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(label: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), `llame-skills-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

function writeSkillFile(
  source: string,
  directory: string,
  content: string,
): string {
  const packageDirectory = path.join(source, directory);
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(path.join(packageDirectory, 'SKILL.md'), content);
  return packageDirectory;
}

function skillDocument(
  name: string,
  options: {
    readonly description?: string;
    readonly extraFrontmatter?: string;
  } = {},
): string {
  const lines = [
    `name: ${name}`,
    `description: ${options.description ?? `The ${name} skill.`}`,
  ];
  if (options.extraFrontmatter !== undefined) {
    lines.push(options.extraFrontmatter);
  }
  return `---\n${lines.join('\n')}\n---\n# Instructions\n`;
}

function createPackage(
  source: string,
  name: string,
  options: {
    readonly description?: string;
    readonly extraFrontmatter?: string;
    readonly sidecars?: Readonly<Record<string, string>>;
  } = {},
): string {
  const packageDirectory = writeSkillFile(
    source,
    name,
    skillDocument(name, options),
  );
  for (const [relativePath, content] of Object.entries(
    options.sidecars ?? {},
  )) {
    const filePath = path.join(packageDirectory, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
  return packageDirectory;
}

function snapshotOf(...directories: Array<string>): SkillCatalogSnapshot {
  return new SkillCatalog(directories).getSnapshot();
}

function snapshotWith(
  directories: Array<string>,
  fileSystem: SkillCatalogFileSystem,
): SkillCatalogSnapshot {
  return new SkillCatalog(directories, fileSystem).getSnapshot();
}

function entryNamed(
  snapshot: SkillCatalogSnapshot,
  name: string,
): SkillCatalogEntry {
  const entry = snapshot.entries.find((candidate) => candidate.name === name);
  if (entry === undefined) {
    throw new Error(
      `No catalog entry named ${name}; saw ${snapshot.entries.map((candidate) => candidate.name).join(', ')}`,
    );
  }
  return entry;
}

describe('SkillCatalog discovery', () => {
  it('returns an empty catalog when no source is configured', () => {
    expect(new SkillCatalog([]).getSnapshot()).toEqual({
      available: true,
      directories: [],
      entries: [],
      diagnostics: [],
    });
  });

  it('discovers immediate child packages of a collection root only', () => {
    const source = temporaryDirectory('source');
    createPackage(source, 'pdf');
    createPackage(source, 'research', { description: 'Plan an investigation' });
    mkdirSync(path.join(source, 'not-a-package'));
    writeFileSync(path.join(source, 'notes.txt'), 'notes');
    writeFileSync(
      path.join(source, 'SKILL.md'),
      skillDocument(path.basename(source)),
    );

    const snapshot = snapshotOf(source);

    expect(snapshot.available).toBe(true);
    expect(snapshot.entries.map((entry) => entry.name)).toEqual([
      'pdf',
      'research',
    ]);
    const pdf = entryNamed(snapshot, 'pdf');
    expect(pdf.available).toBe(true);
    expect(pdf.proactive).toBe(true);
    expect(pdf.description).toBe('The pdf skill.');
    expect(pdf.sourceDirectory).toBe(source);
    expect(pdf.skillDirectory).toBe(path.join(source, 'pdf'));
  });

  it('orders entries by code-point name order', () => {
    const source = temporaryDirectory('ordered');
    createPackage(source, 'zeta');
    createPackage(source, 'alpha');

    expect(snapshotOf(source).entries.map((entry) => entry.name)).toEqual([
      'alpha',
      'zeta',
    ]);
  });

  it('lets a later source override the same package name', () => {
    const base = temporaryDirectory('base');
    const override = temporaryDirectory('override');
    createPackage(base, 'review', { description: 'Base review' });
    createPackage(override, 'review', { description: 'Override review' });

    const snapshot = snapshotOf(base, override);

    expect(snapshot.entries).toHaveLength(1);
    const review = entryNamed(snapshot, 'review');
    expect(review.description).toBe('Override review');
    expect(review.sourceDirectory).toBe(override);
  });

  it('keeps an invalid later winner unavailable without revealing the earlier body', () => {
    const base = temporaryDirectory('base');
    const override = temporaryDirectory('override');
    createPackage(base, 'review', { description: 'Base review' });
    createPackage(base, 'pdf');
    writeSkillFile(
      override,
      'review',
      '---\nname: review\n---\n# no description\n',
    );

    const snapshot = snapshotOf(base, override);

    expect(snapshot.available).toBe(true);
    const review = entryNamed(snapshot, 'review');
    expect(review.available).toBe(false);
    expect(review.description).toBeNull();
    expect(review.diagnostics.join(' ')).toContain('description');
    expect(entryNamed(snapshot, 'pdf').available).toBe(true);
  });

  it('rejects a package whose name disagrees with its directory', () => {
    const source = temporaryDirectory('mismatch');
    createPackage(source, 'other', { description: 'Elsewhere' });
    writeSkillFile(
      source,
      'pdf',
      skillDocument('other', { description: 'Mismatched' }),
    );

    const snapshot = snapshotOf(source);

    expect(entryNamed(snapshot, 'pdf').available).toBe(false);
    expect(entryNamed(snapshot, 'pdf').diagnostics.join(' ')).toContain(
      'does not match its directory',
    );
  });

  it('rejects duplicate YAML keys in frontmatter', () => {
    const source = temporaryDirectory('duplicate');
    writeSkillFile(
      source,
      'pdf',
      '---\nname: pdf\ndescription: first\ndescription: second\n---\n# Body\n',
    );

    expect(entryNamed(snapshotOf(source), 'pdf').available).toBe(false);
  });

  it('re-reads a package on every snapshot', () => {
    const source = temporaryDirectory('live');
    createPackage(source, 'pdf', { description: 'First' });
    expect(entryNamed(snapshotOf(source), 'pdf').description).toBe('First');

    createPackage(source, 'pdf', { description: 'Second' });
    expect(entryNamed(snapshotOf(source), 'pdf').description).toBe('Second');
  });

  it('makes the catalog unavailable when a source cannot be read', () => {
    const good = temporaryDirectory('good');
    createPackage(good, 'pdf');
    const notADirectory = path.join(good, 'notes.txt');
    writeFileSync(notADirectory, 'notes');

    const snapshot = snapshotOf(good, notADirectory);

    expect(snapshot.available).toBe(false);
    expect(snapshot.entries).toEqual([]);
    expect(snapshot.diagnostics).toHaveLength(1);
  });

  it('makes the catalog unavailable when a configured source is missing', () => {
    const good = temporaryDirectory('good');
    createPackage(good, 'pdf');

    const snapshot = snapshotOf(good, path.join(good, 'absent'));

    expect(snapshot.available).toBe(false);
    expect(snapshot.entries).toEqual([]);
  });

  it('refuses to resolve precedence above the configured-source bound', () => {
    const directories = Array.from(
      { length: MAX_SKILL_SOURCES + 1 },
      (_, index) => `/opt/skills-${index}`,
    );

    expect(new SkillCatalog(directories).getSnapshot().available).toBe(false);
  });

  it('refuses to resolve precedence above the per-source child bound', () => {
    const source = temporaryDirectory('wide');
    const children: ReadonlyArray<CatalogDirent> = Array.from(
      { length: MAX_SOURCE_CHILDREN + 1 },
      (_, index) => ({
        name: `p${index}`,
        isDirectory: () => true,
        isSymbolicLink: () => false,
      }),
    );

    const snapshot = snapshotWith([source], {
      ...NODE_SKILL_FILE_SYSTEM,
      readDirectory: () => children,
    });

    expect(snapshot.available).toBe(false);
    expect(snapshot.entries).toEqual([]);
  });

  it(
    'stops reading at the child bound and refuses the oversized source',
    { timeout: 20_000 },
    () => {
      const source = temporaryDirectory('real-oversized');
      // Two past the bound, so a missing early break is observable: the read
      // would then return every child instead of exactly MAX_SOURCE_CHILDREN+1.
      for (let i = 0; i <= MAX_SOURCE_CHILDREN + 1; i += 1) {
        mkdirSync(path.join(source, String(i)));
      }

      // The production seam bounds the work itself, which is what keeps an
      // oversized directory from being materialized before the catalog
      // rejects it.
      expect(NODE_SKILL_FILE_SYSTEM.readDirectory(source)).toHaveLength(
        MAX_SOURCE_CHILDREN + 1,
      );

      const snapshot = snapshotOf(source);

      expect(snapshot.available).toBe(false);
      expect(snapshot.diagnostics.join(' ')).toContain('exceeds');
    },
  );

  it('follows a configured source root symlink to its real directory', () => {
    const real = temporaryDirectory('real');
    createPackage(real, 'pdf');
    const link = path.join(temporaryDirectory('link-parent'), 'source');
    symlinkSync(real, link, 'dir');

    const snapshot = snapshotOf(link);

    expect(snapshot.available).toBe(true);
    expect(entryNamed(snapshot, 'pdf').skillDirectory).toBe(
      realpathSync(path.join(link, 'pdf')),
    );
  });

  it('refuses a child symlink resolving outside every configured source', () => {
    const source = temporaryDirectory('source');
    const outside = temporaryDirectory('outside');
    createPackage(source, 'pdf');
    createPackage(outside, 'linked');
    symlinkSync(
      path.join(outside, 'linked'),
      path.join(source, 'linked'),
      'dir',
    );

    const snapshot = snapshotOf(source);

    expect(entryNamed(snapshot, 'pdf').available).toBe(true);
    const linked = entryNamed(snapshot, 'linked');
    expect(linked.available).toBe(false);
    expect(linked.diagnostics.join(' ')).toContain('outside');
  });

  it('admits a child symlink whose real target is inside a configured source', () => {
    const shared = temporaryDirectory('shared');
    const source = temporaryDirectory('source');
    createPackage(shared, 'shared-skill');
    symlinkSync(
      path.join(shared, 'shared-skill'),
      path.join(source, 'shared-skill'),
      'dir',
    );

    const snapshot = snapshotOf(shared, source);

    const entry = entryNamed(snapshot, 'shared-skill');
    expect(entry.available).toBe(true);
    expect(entry.sourceDirectory).toBe(source);
    expect(entry.skillDirectory).toBe(
      realpathSync(path.join(shared, 'shared-skill')),
    );
  });

  it('reports a dangling SKILL.md symlink as an unavailable entry', () => {
    const source = temporaryDirectory('dangling-skill');
    const packageDir = path.join(source, 'broken');
    mkdirSync(packageDir);
    symlinkSync('/nonexistent/target', path.join(packageDir, 'SKILL.md'));

    const entry = entryNamed(snapshotOf(source), 'broken');
    expect(entry.available).toBe(false);
    expect(entry.diagnostics.join(' ')).toContain('readable');
  });

  it('refuses a SKILL.md symlink that resolves outside its package directory', () => {
    const source = temporaryDirectory('escape-skill');
    const outside = temporaryDirectory('outside-target');
    writeFileSync(
      path.join(outside, 'stolen.md'),
      '---\nname: pdf\ndescription: Stolen content.\n---\n# Body\n',
    );
    const packageDir = path.join(source, 'pdf');
    mkdirSync(packageDir);
    symlinkSync(
      path.join(outside, 'stolen.md'),
      path.join(packageDir, 'SKILL.md'),
    );

    const entry = entryNamed(snapshotOf(source), 'pdf');
    expect(entry.available).toBe(false);
    expect(entry.diagnostics.join(' ')).toContain('outside');
  });

  it('refuses a sidecar symlink that resolves outside its package directory', () => {
    const source = temporaryDirectory('escape-sidecar');
    const outside = temporaryDirectory('outside-sidecar');
    writeFileSync(
      path.join(outside, 'llame.yaml'),
      'policy:\n  allow_implicit_invocation: false\n',
    );
    createPackage(source, 'pdf');
    const agentsDir = path.join(source, 'pdf', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    symlinkSync(
      path.join(outside, 'llame.yaml'),
      path.join(agentsDir, 'llame.yaml'),
    );

    const entry = entryNamed(snapshotOf(source), 'pdf');
    expect(entry.available).toBe(false);
    expect(entry.diagnostics.join(' ')).toContain('invocation control');
  });
});

describe('SkillCatalog invocation controls', () => {
  function packageWith(
    options: Parameters<typeof createPackage>[2],
  ): SkillCatalogEntry {
    const source = temporaryDirectory('control');
    createPackage(source, 'pdf', options);
    return entryNamed(snapshotOf(source), 'pdf');
  }

  it('lets a configured llame boolean stop resolution despite fallbacks', () => {
    const entry = packageWith({
      extraFrontmatter: 'disable-model-invocation: true',
      sidecars: {
        'agents/llame.yaml': 'policy:\n  allow_implicit_invocation: true\n',
        'agents/openai.yaml': 'policy: [unclosed\n',
      },
    });

    expect(entry.available).toBe(true);
    expect(entry.proactive).toBe(true);
  });

  it('treats a disabling llame boolean as manual-only', () => {
    const entry = packageWith({
      extraFrontmatter: 'disable-model-invocation: false',
      sidecars: {
        'agents/llame.yaml': 'policy:\n  allow_implicit_invocation: false\n',
      },
    });

    expect(entry.proactive).toBe(false);
  });

  it('ignores a malformed frontmatter control when a llame control wins', () => {
    const entry = packageWith({
      extraFrontmatter: 'disable-model-invocation: "not-a-boolean"',
      sidecars: {
        'agents/llame.yaml': 'policy:\n  allow_implicit_invocation: true\n',
      },
    });

    expect(entry.available).toBe(true);
    expect(entry.proactive).toBe(true);
  });

  it('falls through a sidecar that configures no control', () => {
    const entry = packageWith({
      extraFrontmatter: 'disable-model-invocation: true',
      sidecars: { 'agents/llame.yaml': 'policy: {}\n' },
    });

    expect(entry.proactive).toBe(false);
  });

  it('lets frontmatter win over a disabling OpenAI sidecar', () => {
    const entry = packageWith({
      extraFrontmatter: 'disable-model-invocation: false',
      sidecars: {
        'agents/openai.yaml': 'policy:\n  allow_implicit_invocation: false\n',
      },
    });

    expect(entry.proactive).toBe(true);
  });

  it('honours a disabling OpenAI sidecar when nothing higher resolves', () => {
    const entry = packageWith({
      sidecars: {
        'agents/openai.yaml': 'policy:\n  allow_implicit_invocation: false\n',
      },
    });

    expect(entry.proactive).toBe(false);
  });

  it('invalidates the package for a malformed consulted sidecar', () => {
    const entry = packageWith({
      sidecars: { 'agents/llame.yaml': 'policy: [unclosed\n' },
    });

    expect(entry.available).toBe(false);
    expect(entry.proactive).toBe(false);
  });

  it('invalidates the package for a wrong-typed consulted control', () => {
    const entry = packageWith({
      sidecars: {
        'agents/llame.yaml': 'policy:\n  allow_implicit_invocation: "yes"\n',
      },
    });

    expect(entry.available).toBe(false);
  });

  it('invalidates the package for a wrong-typed consulted frontmatter control', () => {
    const entry = packageWith({
      extraFrontmatter: 'disable-model-invocation: "yes"',
    });

    expect(entry.available).toBe(false);
  });

  it('still validates required metadata when a llame control is valid', () => {
    const source = temporaryDirectory('control');
    writeSkillFile(source, 'pdf', '---\nname: pdf\n---\n# No description\n');
    const packageDirectory = path.join(source, 'pdf', 'agents');
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(
      path.join(packageDirectory, 'llame.yaml'),
      'policy:\n  allow_implicit_invocation: true\n',
    );

    expect(entryNamed(snapshotOf(source), 'pdf').available).toBe(false);
  });

  it('invalidates a package with a dangling consulted sidecar symlink', () => {
    const source = temporaryDirectory('dangling-sidecar');
    createPackage(source, 'pdf');
    const agentsDir = path.join(source, 'pdf', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    symlinkSync(
      '/nonexistent/openai.yaml',
      path.join(agentsDir, 'openai.yaml'),
    );

    const entry = entryNamed(snapshotOf(source), 'pdf');
    expect(entry.available).toBe(false);
  });
});
