import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SkillCatalog } from './skill-catalog';
import {
  NO_SKILL_SELECTION,
  isSkillCatalogResult,
  resolveSkillLocator,
} from './skill-target';

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
  const directory = mkdtempSync(
    path.join(tmpdir(), `llame-skill-read-${label}-`),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function createPackage(
  source: string,
  name: string,
  options: { description?: string; sidecar?: string } = {},
): string {
  const packageDirectory = path.join(source, name);
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(
    path.join(packageDirectory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${options.description ?? `The ${name} skill.`}\n---\n# Instructions\n`,
  );
  if (options.sidecar !== undefined) {
    const agents = path.join(packageDirectory, 'agents');
    mkdirSync(agents, { recursive: true });
    writeFileSync(path.join(agents, 'openai.yaml'), options.sidecar);
  }
  return packageDirectory;
}

function catalogFor(source: string): SkillCatalog {
  return new SkillCatalog([source]);
}

function resolverResult(
  source: string,
  locator: string,
  selection: ReadonlySet<string> = NO_SKILL_SELECTION,
) {
  return resolveSkillLocator(catalogFor(source), locator, selection);
}

describe('resolveSkillLocator', () => {
  it('resolves the package root to its SKILL.md', async () => {
    const source = temporaryDirectory('root');
    createPackage(source, 'pdf');

    const resolved = await resolverResult(source, 'pdf');

    expect(resolved).toMatchObject({
      hostPath: path.join(source, 'pdf', 'SKILL.md'),
      locator: 'skill://pdf',
      name: 'pdf',
      skillDirectory: path.join(source, 'pdf'),
    });
  });

  it('resolves the trailing-slash form to the package directory', async () => {
    const source = temporaryDirectory('dir');
    createPackage(source, 'pdf');

    const resolved = await resolverResult(source, 'pdf/');

    expect(resolved).toMatchObject({
      hostPath: `${path.join(source, 'pdf')}${path.sep}`,
      locator: 'skill://pdf/',
    });
  });

  it('resolves a resource and carries its selector through', async () => {
    const source = temporaryDirectory('resource');
    createPackage(source, 'pdf');
    const packageDirectory = path.join(source, 'pdf');
    mkdirSync(path.join(packageDirectory, 'references'));
    writeFileSync(
      path.join(packageDirectory, 'references', 'formats.md'),
      '# Formats\n',
    );

    const resolved = await resolverResult(
      source,
      'pdf/references/formats.md:raw',
    );

    expect(resolved).toMatchObject({
      hostPath: path.join(packageDirectory, 'references', 'formats.md'),
      locator: 'skill://pdf/references/formats.md',
      selector: 'raw',
    });
  });

  it('lists the catalog without reading a package body', async () => {
    const source = temporaryDirectory('catalog');
    createPackage(source, 'pdf');
    createPackage(source, 'research');

    const resolved = await resolverResult(source, '');

    expect(resolved).toMatchObject({ catalog: true });
    if (!isSkillCatalogResult(resolved)) throw new Error('expected catalog');
    expect(resolved.entries.map((entry) => entry.name)).toEqual([
      'pdf',
      'research',
    ]);
  });

  it('hides a manual-only package from the catalog listing', async () => {
    const source = temporaryDirectory('manual-list');
    createPackage(source, 'pdf');
    createPackage(source, 'review', {
      sidecar: 'policy:\n  allow_implicit_invocation: false\n',
    });

    const resolved = await resolverResult(source, '');

    if (!isSkillCatalogResult(resolved)) throw new Error('expected catalog');
    expect(resolved.entries.map((entry) => entry.name)).toEqual(['pdf']);
  });

  it('lists a manual-only package once the turn selected it', async () => {
    const source = temporaryDirectory('manual-selected');
    createPackage(source, 'pdf');
    createPackage(source, 'review', {
      sidecar: 'policy:\n  allow_implicit_invocation: false\n',
    });

    const resolved = await resolverResult(source, '', new Set(['review']));

    if (!isSkillCatalogResult(resolved)) throw new Error('expected catalog');
    expect(resolved.entries.map((entry) => entry.name)).toEqual([
      'pdf',
      'review',
    ]);
  });

  it('refuses a manual-only read without the selection, naming selection', async () => {
    const source = temporaryDirectory('manual-read');
    createPackage(source, 'review', {
      sidecar: 'policy:\n  allow_implicit_invocation: false\n',
    });

    const resolved = await resolverResult(source, 'review');

    expect(resolved).toMatchObject({
      status: 'error',
      type: 'skill_requires_explicit_selection',
    });
    expect('message' in resolved && resolved.message).toContain('$review');
  });

  it('resolves a manual-only read when the turn selected it', async () => {
    const source = temporaryDirectory('manual-ok');
    createPackage(source, 'review', {
      sidecar: 'policy:\n  allow_implicit_invocation: false\n',
    });

    const resolved = await resolverResult(
      source,
      'review',
      new Set(['review']),
    );

    expect(resolved).toMatchObject({
      hostPath: path.join(source, 'review', 'SKILL.md'),
    });
  });

  it('refuses a resource symlink resolving outside the package', async () => {
    const source = temporaryDirectory('escape');
    const outside = temporaryDirectory('outside');
    createPackage(source, 'pdf');
    writeFileSync(path.join(outside, 'secret.md'), 'secret');
    symlinkSync(
      path.join(outside, 'secret.md'),
      path.join(source, 'pdf', 'linked.md'),
    );

    const resolved = await resolverResult(source, 'pdf/linked.md');

    expect(resolved).toMatchObject({ status: 'error', type: 'not_found' });
  });

  it('resolves a resource symlink that stays inside the package', async () => {
    const source = temporaryDirectory('inside-link');
    createPackage(source, 'pdf');
    const packageDirectory = path.join(source, 'pdf');
    writeFileSync(path.join(packageDirectory, 'real.md'), '# Real\n');
    symlinkSync(
      path.join(packageDirectory, 'real.md'),
      path.join(packageDirectory, 'alias.md'),
    );

    const resolved = await resolverResult(source, 'pdf/alias.md');

    expect(resolved).toMatchObject({
      hostPath: path.join(packageDirectory, 'real.md'),
    });
  });

  it('refuses a resource path that escapes the package', async () => {
    const source = temporaryDirectory('traverse');
    createPackage(source, 'pdf');

    expect(await resolverResult(source, 'pdf/../research')).toMatchObject({
      status: 'error',
      type: 'invalid_path',
    });
    expect(await resolverResult(source, 'pdf/%2e%2e/secret')).toMatchObject({
      status: 'error',
      type: 'invalid_path',
    });
  });

  it('refuses an unknown package and an unavailable catalog', async () => {
    const source = temporaryDirectory('unknown');
    createPackage(source, 'pdf');

    expect(await resolverResult(source, 'absent')).toMatchObject({
      status: 'error',
      type: 'not_found',
    });

    const missing = path.join(source, 'gone');
    const unavailable = await resolveSkillLocator(
      new SkillCatalog([missing]),
      'pdf',
      NO_SKILL_SELECTION,
    );
    expect(unavailable).toMatchObject({
      status: 'error',
      type: 'skill_catalog_unavailable',
    });
  });

  it('refuses an unavailable winning package', async () => {
    const source = temporaryDirectory('broken');
    const packageDirectory = path.join(source, 'pdf');
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(
      path.join(packageDirectory, 'SKILL.md'),
      '---\nname: pdf\n---\n',
    );

    expect(await resolverResult(source, 'pdf')).toMatchObject({
      status: 'error',
      type: 'skill_unavailable',
    });
  });
});
