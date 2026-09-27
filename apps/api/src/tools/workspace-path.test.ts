import { describe, expect, it } from 'vitest';

import {
  createWorkspaceRootCell,
  isWorkspaceRelative,
  resolveWorkspacePath,
} from './workspace-path';

describe('workspace path projection', () => {
  it('resolves lexically and preserves a trailing separator', () => {
    expect(resolveWorkspacePath('/work/project', 'src/app.ts')).toBe(
      '/work/project/src/app.ts',
    );
    expect(resolveWorkspacePath('/work/project', '../shared/data.json')).toBe(
      '/work/shared/data.json',
    );
    expect(resolveWorkspacePath('/work/project', 'app.ts/')).toBe(
      '/work/project/app.ts/',
    );
  });

  it('recognizes relative paths without treating schemes as local paths', () => {
    expect(isWorkspaceRelative('src/app.ts')).toBe(true);
    expect(isWorkspaceRelative('../shared')).toBe(true);
    expect(isWorkspaceRelative('/work/project/src')).toBe(false);
    expect(isWorkspaceRelative('KB://Space/file')).toBe(false);
    expect(isWorkspaceRelative('vault://notes/file')).toBe(false);
  });

  it('commits root changes and claims one transition per model step', () => {
    const cell = createWorkspaceRootCell('/work/old');

    expect(cell.current()).toBe('/work/old');
    cell.commit('/work/new');
    expect(cell.current()).toBe('/work/old');
    expect(cell.claimTransition()).toBe(true);
    expect(cell.claimTransition()).toBe(false);

    cell.beginStep();
    expect(cell.current()).toBe('/work/new');
    expect(cell.claimTransition()).toBe(true);
    expect(cell.claimTransition()).toBe(false);

    cell.commit(undefined);
    expect(cell.current()).toBe('/work/new');
    expect(cell.claimTransition()).toBe(false);
    cell.beginStep();
    expect(cell.current()).toBeUndefined();
    expect(cell.claimTransition()).toBe(true);
  });
});
