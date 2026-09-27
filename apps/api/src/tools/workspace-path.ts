import { posix } from 'node:path';

import { parsePathScheme } from '@workspace/native-file-tools';

export type WorkspaceRootCell = {
  current(): string | undefined;
  commit(root: string | undefined): void;
  claimTransition(): boolean;
};

export function createWorkspaceRootCell(
  initial: string | undefined,
): WorkspaceRootCell & { beginStep(): void } {
  let currentRoot = initial;
  let pendingRoot: string | undefined;
  let hasPendingRoot = false;
  let transitionClaimed = false;
  return {
    current: () => currentRoot,
    commit: (root) => {
      pendingRoot = root;
      hasPendingRoot = true;
    },
    beginStep: () => {
      if (hasPendingRoot) {
        currentRoot = pendingRoot;
        pendingRoot = undefined;
        hasPendingRoot = false;
      }
      transitionClaimed = false;
    },
    claimTransition: () => {
      if (transitionClaimed) return false;
      transitionClaimed = true;
      return true;
    },
  };
}

export function resolveWorkspacePath(root: string, value: string): string {
  const resolved = posix.resolve(root, value);
  return value.endsWith('/') && resolved !== '/' ? `${resolved}/` : resolved;
}

export function isWorkspaceRelative(value: string): boolean {
  return !value.startsWith('/') && parsePathScheme(value) === undefined;
}
