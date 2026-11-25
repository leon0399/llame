import type {
  MachineMethod,
  MachineMethodParams,
  MachineMethodResults,
} from '@workspace/machine-protocol';
import type {
  MachineSession,
  MachineRequestOptions,
} from '../machine-session.js';
import { filesHandlers } from './files.js';
import { gitHandlers } from './git.js';
import { jobsHandlers } from './jobs.js';
import { machineHandlers } from './machine.js';
import { mcpHandlers } from './mcp.js';
import { searchHandlers } from './search.js';

export type Handler<M extends MachineMethod = MachineMethod> = (
  session: MachineSession,
  params: MachineMethodParams[M],
  options?: MachineRequestOptions,
) => Promise<MachineMethodResults[M]>;

const handlers: Partial<{ [M in MachineMethod]: Handler<M> }> = {
  ...filesHandlers,
  ...searchHandlers,
  ...gitHandlers,
  ...mcpHandlers,
  ...jobsHandlers,
  ...machineHandlers,
};

export async function dispatchWireHandler<M extends MachineMethod>(
  session: MachineSession,
  method: M,
  params: MachineMethodParams[M],
  options?: MachineRequestOptions,
): Promise<MachineMethodResults[M]> {
  const handler = handlers[method];

  if (!handler) throw new Error(`Machine method is not implemented: ${method}`);

  return handler(session, params, options);
}
