import type { MachineMethodParams } from '@workspace/machine-protocol';
import type { Handler } from './index.js';
import { bytesHandler } from './files-bytes.js';
import { editHandler, writeHandler } from './files-mutate.js';
import { listHandler, readHandler, statHandler } from './files-read.js';

export {
  bytesHandler,
  editHandler,
  listHandler,
  readHandler,
  statHandler,
  writeHandler,
};

export const filesHandlers = {
  'fs.stat': statHandler,
  'fs.list': listHandler,
  'fs.read': readHandler,
  'fs.edit': editHandler,
  'fs.write': writeHandler,
  'fs.bytes': bytesHandler,
} satisfies Partial<{ [M in keyof MachineMethodParams]: Handler<M> }>;
