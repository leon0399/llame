import type { MachineMethodParams, MachineMethodResults } from '@workspace/machine-protocol';

import type { MachineRequestOptions, MachineSession } from '../machine-session.js';

/** `roots.list`: the Machine's registered roots, as the daemon lists them now. */
async function rootsList(
  session: MachineSession,
  _params: MachineMethodParams['roots.list'],
  options?: MachineRequestOptions,
): Promise<MachineMethodResults['roots.list']> {
  try {
    const response = await session.clients.machine.listRoots({}, session.callOptions(options));

    return { roots: response.roots.map((root) => root.path) };
  } catch (error) {
    throw session.mapRefusal(error);
  }
}

export const machineHandlers = { 'roots.list': rootsList };
