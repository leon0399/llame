import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  KnowledgeSpaceLocalResolver,
  KnowledgeSpaceUnavailableError,
  type KnowledgeFileSystem,
} from './knowledge-space.local-resolver';

const SPACE_ID = '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e';

describe('KnowledgeSpaceLocalResolver', () => {
  it('creates the trusted stable-ID child beneath the canonical root', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'llame-knowledge-root-'));
    const resolver = new KnowledgeSpaceLocalResolver(root);

    const child = resolver.ensureChild(resolver.resolveRoot(), SPACE_ID);

    expect(child).toBe(path.join(root, SPACE_ID));
    expect(lstatSync(child).isDirectory()).toBe(true);
  });

  it('accepts an existing real directory on an idempotent retry', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'llame-knowledge-root-'));
    mkdirSync(path.join(root, SPACE_ID));
    const resolver = new KnowledgeSpaceLocalResolver(root);

    expect(resolver.ensureChild(resolver.resolveRoot(), SPACE_ID)).toBe(
      path.join(root, SPACE_ID),
    );
  });

  it('refuses a missing child during read-only binding resolution without creating it', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'llame-knowledge-root-'));
    const child = path.join(root, SPACE_ID);
    const resolver = new KnowledgeSpaceLocalResolver(root);

    expect(() =>
      resolver.resolveChild(resolver.resolveRoot(), SPACE_ID),
    ).toThrow(KnowledgeSpaceUnavailableError);
    expect(() => lstatSync(child)).toThrow(/ENOENT/);
  });

  it('accepts a real directory created by a concurrent mkdir race', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'llame-knowledge-root-'));
    const child = path.join(root, SPACE_ID);
    let childLookedUp = false;
    const fileSystem: KnowledgeFileSystem = {
      lstatSync: (filePath) => {
        if (filePath === child && !childLookedUp) {
          childLookedUp = true;
          throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        }
        return lstatSync(filePath);
      },
      mkdirSync: (directoryPath) => {
        mkdirSync(directoryPath);
        throw Object.assign(new Error('concurrent create'), { code: 'EEXIST' });
      },
      realpathSync: (filePath) => realpathSync(filePath),
    };
    const resolver = new KnowledgeSpaceLocalResolver(root, fileSystem);

    expect(resolver.ensureChild(resolver.resolveRoot(), SPACE_ID)).toBe(child);
  });

  it.each(['symlink', 'file'])(
    'refuses a derived %s child without following or replacing it',
    (kind) => {
      const root = mkdtempSync(path.join(tmpdir(), 'llame-knowledge-root-'));
      const child = path.join(root, SPACE_ID);
      if (kind === 'symlink') {
        const target = mkdtempSync(
          path.join(tmpdir(), 'llame-knowledge-target-'),
        );
        symlinkSync(target, child, 'dir');
      } else {
        writeFileSync(child, 'not a directory');
      }
      const resolver = new KnowledgeSpaceLocalResolver(root);

      expect(() =>
        resolver.ensureChild(resolver.resolveRoot(), SPACE_ID),
      ).toThrow(KnowledgeSpaceUnavailableError);
      expect(() =>
        resolver.ensureChild(resolver.resolveRoot(), SPACE_ID),
      ).toThrow(/unavailable/i);
    },
  );

  it('fails closed without exposing the configured root when it is unavailable', () => {
    const root = path.join(tmpdir(), 'llame-knowledge-root-does-not-exist');
    const resolver = new KnowledgeSpaceLocalResolver(root);

    try {
      resolver.resolveRoot();
      expect.unreachable('expected unavailable root');
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeSpaceUnavailableError);
      expect(error).not.toHaveProperty(
        'message',
        expect.stringContaining(root),
      );
    }
  });

  it('does not permit a path-shaped trusted identifier to escape the root', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'llame-knowledge-root-'));
    const resolver = new KnowledgeSpaceLocalResolver(root);

    expect(() =>
      resolver.ensureChild(resolver.resolveRoot(), '../escape'),
    ).toThrow(KnowledgeSpaceUnavailableError);
  });
});
