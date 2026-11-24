import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  createFile,
  editFile,
  readResolvedFile,
  replaceFile,
  statHostPath,
} from '@workspace/native-file-tools';
import { type JsonValue } from '@workspace/machine-protocol';

import { MachineConnector } from '../machines/machine-connector.service';
import type { MachineTransportFactory } from '../machines/machine-transport';
import { DEFAULT_LOCAL_MACHINE_NAME } from './local-machine';
import {
  createProtocolPeer,
  type PeerCall,
  type PeerSession,
  type ProtocolPeerOptions,
  wireJson,
} from './machine-protocol-peer';

export type MachineFilesCall = PeerCall;
export type MachineFilesSession = Pick<PeerSession, 'requests' | 'calls'>;
export type MachineFilesPeer = {
  readonly sessions: ReadonlyArray<MachineFilesSession>;
  session(index: number): Promise<MachineFilesSession>;
};
export type MachineFilesPeerOptions = Pick<ProtocolPeerOptions, 'roots' | 'onNotification'> & {
  readonly name?: string;
  readonly onRequest?: (method: string) => void;
};
export type MachineFilesConnector = MachineConnector & { readonly peer: MachineFilesPeer };

function displayPath(params: Record<string, unknown>, path: string): string {
  const options = params['options'];
  if (typeof options !== 'object' || options === null) return path;
  const prefix = (options as Record<string, unknown>)['displayPrefix'];
  return typeof prefix === 'string' ? `${prefix}${path}` : path;
}

async function guardedPath(path: string, roots: ReadonlyArray<string>): Promise<string | undefined> {
  try {
    const canonical = await realpath(path);
    if (roots.some((root) => {
      const rel = relative(root, canonical);
      return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
    })) return canonical;
  } catch {
    const candidate = resolve(path);
    if (roots.some((root) => {
      const rel = relative(root, candidate);
      return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
    })) return candidate;
  }
  return undefined;
}

function failure(type: string, message: string): JsonValue {
  return { status: 'error', type, message };
}

async function answerFileCall(
  call: PeerCall,
  options: MachineFilesPeerOptions,
): Promise<JsonValue> {
  options.onRequest?.(call.method);
  const params = call.params as Record<string, unknown>;
  if (call.method === 'roots.list') return wireJson({ roots: options.roots ?? ['/'] });
  const path = typeof params['path'] === 'string' ? params['path'] : undefined;
  if (path === undefined) return failure('invalid_input', 'A host path is required.');
  const guarded = await guardedPath(path, options.roots ?? ['/']);
  if (guarded === undefined)
    return failure('invalid_path', 'The path is outside every root registered on this Machine.');
  try {
    if (call.method === 'fs.stat') {
      const result = await statHostPath(guarded);
      const link = await lstat(guarded).then((stat) => stat.isSymbolicLink(), () => false);
      return wireJson({ kind: result.kind, ...(result.kind === 'missing' ? {} : { size: result.size, realPath: displayPath(params, result.canonicalPath) }), isLink: link });
    }
    if (call.method === 'fs.list') {
      const entries = await readdir(guarded, { withFileTypes: true });
      const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
      const limited = sorted.slice(0, 1000).map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'link' : 'other',
      }));
      return wireJson({ entries: limited, totalCount: sorted.length, truncated: sorted.length > limited.length });
    }
    if (call.method === 'fs.read') {
      const display = displayPath(params, guarded);
      const displayOptions = typeof params['options'] === 'object' && params['options'] !== null
        ? params['options'] as Record<string, unknown>
        : {};
      return wireJson(await readResolvedFile(guarded, {
        displayPath: display,
        ...(typeof displayOptions['selector'] === 'string' ? { selector: displayOptions['selector'] } : {}),
        ...(typeof displayOptions['reserveCodeUnits'] === 'number' ? { reserveCodeUnits: displayOptions['reserveCodeUnits'] } : {}),
        followSymlinks: true,
      }));
    }
    if (call.method === 'fs.edit') {
      const display = displayPath(params, guarded);
      const displayOptions = typeof params['options'] === 'object' && params['options'] !== null ? params['options'] as Record<string, unknown> : {};
      return wireJson(await editFile({ path: guarded, oldText: String(params['oldText'] ?? ''), newText: String(params['newText'] ?? '') }, undefined, {
        displayPath: display,
        ...(typeof displayOptions['reserveCodeUnits'] === 'number' ? { reserveCodeUnits: displayOptions['reserveCodeUnits'] } : {}),
      }));
    }
    if (call.method === 'fs.write') {
      const display = displayPath(params, guarded);
      const input = { path: guarded, content: String(params['content'] ?? '') };
      const displayOptions = typeof params['options'] === 'object' && params['options'] !== null ? params['options'] as Record<string, unknown> : {};
      const mutationOptions = { displayPath: display, ...(typeof displayOptions['reserveCodeUnits'] === 'number' ? { reserveCodeUnits: displayOptions['reserveCodeUnits'] } : {}) };
      return wireJson(params['replace'] === true
        ? await replaceFile(input, undefined, mutationOptions)
        : await createFile(input, undefined, mutationOptions));
    }
    return failure('invalid_input', `${call.method} is not implemented by this file peer.`);
  } catch (error) {
    return failure('not_found', error instanceof Error ? error.message : String(error));
  }
}

function createFilePeer(options: MachineFilesPeerOptions) {
  return createProtocolPeer({
    roots: options.roots ?? ['/'],
    onNotification: options.onNotification,
    answer: (call) => answerFileCall(call, options).then((value) => ({ value })),
  });
}

export function machineFilesTransportFactory(
  options: Pick<MachineFilesPeerOptions, 'roots' | 'onRequest'> = {},
): MachineTransportFactory {
  return createFilePeer(options).factory;
}

export function machineFilesConnector(options: MachineFilesPeerOptions = {}): MachineFilesConnector {
  const name = options.name ?? DEFAULT_LOCAL_MACHINE_NAME;
  const peer = createFilePeer(options);
  const connector = new MachineConnector({
    machines: { local: name, default: name, hosts: { [name]: {} } },
    hubVersion: '0.0.0-machine-files-test',
    bindIdentity: () => Promise.resolve('match'),
    transportFactory: peer.factory,
  });
  return Object.assign(connector, {
    peer: {
      sessions: peer.sessions,
      session: async (index: number) => peer.session(index),
    } satisfies MachineFilesPeer,
  });
}
