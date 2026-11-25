/**
 * A real `MachineConnector` whose own Machine is answered by an in-process
 * protocol peer (host-as-machine test scaffolding). Tool tests need the local
 * Machine to be reachable and identity-checked without a daemon, and they need
 * it to be IMPOSSIBLE for a local target to spend a daemon request: the peer
 * answers the handshake and throws on anything else, so a tool that routes a
 * local target through the Machine surface fails loudly instead of quietly
 * succeeding. Assert "only the handshake happened" through the exported peer.
 *
 * Deliberately under `src/testing/`: scaffolding, excluded from coverage and
 * mutation, never imported by production code.
 */

import { lstat } from 'node:fs/promises';

import { Code, ConnectError } from '@connectrpc/connect';
import { statHostPath } from '@workspace/native-file-tools';
import { isRecord, isString } from '@workspace/runtime-safety';

import { MachineConnector } from '../machines/machine-connector.service';

import {
  createProtocolPeer,
  type ProtocolPeer,
  type ProtocolPeerOptions,
  wireJson,
} from './machine-protocol-peer';

/** The default local Machine name the helper configures. */
export const DEFAULT_LOCAL_MACHINE_NAME = 'host-a';

export type LocalMachineConnectorOptions = {
  /** `machines.local` and `machines.default`, both this name. */
  readonly name?: string;
  /** Replaces the real handshake check, so a test can drive the refusal. */
  readonly verify?: () => Promise<void>;
  /** Replaces one daemon method answer for a focused refusal test. */
  readonly answer?: ProtocolPeerOptions['answer'];
};

async function localStat(path: string) {
  const result = await statHostPath(path);
  let isLink = false;

  try {
    isLink = (await lstat(path)).isSymbolicLink();
  } catch {}

  if (result.kind === 'missing') return wireJson({ kind: result.kind, isLink });

  return wireJson({
    kind: result.kind,
    size: result.size,
    realPath: result.canonicalPath,
    isLink,
  });
}

export type LocalMachineConnector = MachineConnector & {
  /** The daemon side; its sessions prove nothing but `hello` was sent. */
  readonly peer: ProtocolPeer;
};

export function localMachineConnector(
  options: LocalMachineConnectorOptions = {},
): LocalMachineConnector {
  const name = options.name ?? DEFAULT_LOCAL_MACHINE_NAME;

  const peer = createProtocolPeer({
    answer: async (call) => {
      const override = await options.answer?.(call);

      if (override !== undefined) return override;

      if (call.method === 'fs.stat') {
        const params = call.params;

        if (!isRecord(params) || !isString(params['path']))
          throw new ConnectError(
            'A host path is required.',
            Code.InvalidArgument,
          );

        return { value: await localStat(params['path']) };
      }

      throw new ConnectError(
        `the local Machine connector received an unexpected ${call.method} request`,
        Code.Unimplemented,
      );
    },
  });

  const connector = new MachineConnector({
    machines: { local: name, default: name, hosts: { [name]: {} } },
    hubVersion: '0.0.0-local-machine-test',
    bindIdentity: () => Promise.resolve('match'),
    transportFactory: peer.factory,
  });

  if (options.verify !== undefined) connector.verifyLocal = options.verify;

  return Object.assign(connector, { peer });
}
