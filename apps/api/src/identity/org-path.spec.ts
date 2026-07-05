import {
  childPath,
  isDescendantPath,
  pathDepth,
  pathIds,
  rebasePath,
  rootPath,
} from './org-path';

describe('org-path', () => {
  const a = 'aaaaaaaa-0000-0000-0000-000000000001';
  const b = 'bbbbbbbb-0000-0000-0000-000000000002';
  const c = 'cccccccc-0000-0000-0000-000000000003';

  it('builds root and child paths from ids', () => {
    expect(rootPath(a)).toBe(a);
    expect(childPath(rootPath(a), b)).toBe(`${a}/${b}`);
    expect(childPath(childPath(a, b), c)).toBe(`${a}/${b}/${c}`);
  });

  it('decodes ancestor-or-self ids, root first', () => {
    expect(pathIds(`${a}/${b}/${c}`)).toEqual([a, b, c]);
    expect(pathIds(a)).toEqual([a]);
    expect(pathDepth(`${a}/${b}`)).toBe(2);
  });

  it('detects strict descendants only', () => {
    expect(isDescendantPath(`${a}/${b}`, a)).toBe(true);
    expect(isDescendantPath(`${a}/${b}/${c}`, a)).toBe(true);
    expect(isDescendantPath(a, a)).toBe(false);
    expect(isDescendantPath(`${b}/${c}`, a)).toBe(false);
  });

  it('rebases a subtree onto a new prefix (move)', () => {
    const oldPrefix = `${a}/${b}`;
    const newPrefix = `${c}/${b}`;
    expect(rebasePath(oldPrefix, oldPrefix, newPrefix)).toBe(newPrefix);
    expect(rebasePath(`${a}/${b}/${c}`, oldPrefix, newPrefix)).toBe(
      `${c}/${b}/${c}`,
    );
  });

  it('refuses to rebase a path outside the subtree', () => {
    expect(() => rebasePath(`${b}/${c}`, a, c)).toThrow(/not inside subtree/);
  });
});
