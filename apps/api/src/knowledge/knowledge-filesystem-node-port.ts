/** The real Node `fs`-backed `KnowledgeFilesystemPort`, opened with `O_NOFOLLOW`
 * so a symlinked target fails at the syscall rather than relying solely on the
 * adapter's own `lstat` checks, and with `O_NONBLOCK` so a FIFO at a leaf
 * returns a handle the walk's `isFile` check refuses instead of stalling. */

import { constants, promises as fs } from 'node:fs';

import type { KnowledgeFilesystemPort } from './knowledge-filesystem';

export const NODE_FILESYSTEM: KnowledgeFilesystemPort = {
  lstat: (filePath) => fs.lstat(filePath),
  opendir: (directoryPath) => fs.opendir(directoryPath),
  open: async (filePath) => {
    const handle = await fs.open(
      filePath,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );

    return {
      stat: async () => {
        const stats = await handle.stat();

        return {
          size: stats.size,
          isDirectory: () => stats.isDirectory(),
          isFile: () => stats.isFile(),
          isSymbolicLink: () => stats.isSymbolicLink(),
        };
      },
      read: async (buffer, offset, length, position) => {
        const result = await handle.read(buffer, offset, length, position);

        return { bytesRead: result.bytesRead };
      },
      close: () => handle.close(),
    };
  },
  realpath: (filePath) => fs.realpath(filePath),
  mkdir: async (directoryPath) => {
    await fs.mkdir(directoryPath);
  },
};
