import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

import { SkillCatalog } from './skill-catalog';
import {
  NO_SKILL_SELECTION,
  SKILL_PATH_INSTRUCTION,
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

  it('follows a resource symlink resolving outside the package', async () => {
    const source = temporaryDirectory('escape');
    const outside = temporaryDirectory('outside');
    createPackage(source, 'pdf');
    const packageDirectory = path.join(source, 'pdf');
    writeFileSync(path.join(outside, 'secret.md'), 'secret');
    symlinkSync(
      path.join(outside, 'secret.md'),
      path.join(packageDirectory, 'linked.md'),
    );

    const resolved = await resolverResult(source, 'pdf/linked.md');

    // A configured source is trusted, so the link is followed and the target
    // names the link path the model asked for.
    expect(resolved).toMatchObject({
      hostPath: path.join(packageDirectory, 'linked.md'),
    });
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
      hostPath: path.join(packageDirectory, 'alias.md'),
    });
  });

  it('reads a package whose configured source root is a symlink', async () => {
    const real = temporaryDirectory('real-root');
    createPackage(real, 'pdf');
    mkdirSync(join(real, 'pdf', 'references'), { recursive: true });
    writeFileSync(join(real, 'pdf', 'references', 'guide.md'), '# Guide\n');
    const link = join(temporaryDirectory('link-root'), 'source');
    symlinkSync(real, link, 'dir');

    // Links are followed as the host resolves them, so a mounted or symlinked
    // source reads through the configured link path and never its real one.
    const root = await resolverResult(link, 'pdf');
    expect(root).toMatchObject({
      hostPath: join(link, 'pdf', 'SKILL.md'),
      skillDirectory: join(link, 'pdf'),
    });

    const resource = await resolverResult(link, 'pdf/references/guide.md');
    expect(resource).toMatchObject({
      hostPath: join(link, 'pdf', 'references', 'guide.md'),
    });

    const listing = await resolverResult(link, 'pdf/');
    expect(listing).toMatchObject({
      hostPath: `${join(link, 'pdf')}${path.sep}`,
    });
  });

  it('publishes realSkillDirectory only when the package path is not canonical', async () => {
    const real = realpathSync(temporaryDirectory('real-package'));
    createPackage(real, 'pdf');

    expect(await resolverResult(real, 'pdf')).not.toHaveProperty(
      'realSkillDirectory',
    );

    const link = join(temporaryDirectory('linked-package'), 'source');
    symlinkSync(real, link, 'dir');

    expect(await resolverResult(link, 'pdf')).toMatchObject({
      skillDirectory: join(link, 'pdf'),
      realSkillDirectory: join(real, 'pdf'),
    });
  });

  it('resolves beneath an intermediate symlink and leaves an absent leaf to the reader', async () => {
    const source = temporaryDirectory('escape-dir');
    const outside = temporaryDirectory('outside-dir');
    createPackage(source, 'pdf');
    const packageDirectory = join(source, 'pdf');
    mkdirSync(join(outside, 'nested'), { recursive: true });
    writeFileSync(join(outside, 'nested', 'present.md'), '# Outside\n');
    symlinkSync(join(outside, 'nested'), join(packageDirectory, 'link'), 'dir');

    // Resolution touches nothing on disk, so both leaves name the discovered
    // link path and the reader's own open is what reports the absent one.
    expect(await resolverResult(source, 'pdf/link/absent.md')).toMatchObject({
      hostPath: join(packageDirectory, 'link', 'absent.md'),
    });
    expect(await resolverResult(source, 'pdf/link/present.md')).toMatchObject({
      hostPath: join(packageDirectory, 'link', 'present.md'),
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

  it('reports a closed, bounded reason for each failure', async () => {
    const source = temporaryDirectory('messages');
    createPackage(source, 'pdf');

    // Each type is a closed vocabulary the caller switches on, and each message
    // is bounded and names no host path beyond the package it describes.
    expect(await resolverResult(source, 'PDF!')).toMatchObject({
      status: 'error',
      type: 'invalid_path',
      message: 'The skill locator is invalid.',
    });
    expect(await resolverResult(source, 'absent')).toMatchObject({
      status: 'error',
      type: 'not_found',
      message: 'File not found.',
    });
    const missing = path.join(source, 'gone');
    expect(
      await resolveSkillLocator(
        new SkillCatalog([missing]),
        'pdf',
        NO_SKILL_SELECTION,
      ),
    ).toMatchObject({
      status: 'error',
      type: 'skill_catalog_unavailable',
      message: 'The skill catalog is unavailable.',
    });
  });

  it('names the manual-only refusal exactly, with the skill it needs', async () => {
    const source = temporaryDirectory('manual-message');
    createPackage(source, 'review', {
      sidecar: 'policy:\n  allow_implicit_invocation: false\n',
    });

    // The `$name` interpolated into the message is what tells the model how to
    // ask for the skill, so it is pinned rather than pattern-matched.
    expect(await resolverResult(source, 'review')).toEqual({
      status: 'error',
      type: 'skill_requires_explicit_selection',
      message:
        'The skill `review` is manual-only. It loads only when the user names it explicitly in the current turn, for example by writing `$review`.',
    });
  });

  it('names an unusable package exactly, without revealing why', async () => {
    const source = temporaryDirectory('unavailable-message');
    const packageDirectory = path.join(source, 'pdf');
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(
      path.join(packageDirectory, 'SKILL.md'),
      '---\nname: pdf\n---\n',
    );

    // The operator diagnostic stays out of the model-facing message: the model
    // learns the package is unusable, not what is wrong with it on disk.
    expect(await resolverResult(source, 'pdf')).toEqual({
      status: 'error',
      type: 'skill_unavailable',
      message: 'The skill package is unavailable.',
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

/**
 * Packaged-template pin. The instruction is a field of every skill read, so its
 * bytes reach the model verbatim; the expected value is written out here rather
 * than matched against the constant the template renders, which would pass no
 * matter which bytes the file held. It is deliberately not the rail's path
 * guidance in `chats/prompts/skill-activation.md`: two different sentences for
 * two different surfaces.
 */
describe('SKILL_PATH_INSTRUCTION', () => {
  it('pins the packaged instruction byte for byte', () => {
    expect(SKILL_PATH_INSTRUCTION).toBe(
      'Resolve package-relative references and script paths against skillDirectory and use the resulting absolute paths in tool calls. Preserve task-relative input arguments as given, and choose `cwd` explicitly when a script requires its own directory.',
    );
  });
});
