import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  addWorktree,
  inspectRepository,
  listWorktrees,
  locateRepository,
  removeWorktree,
  stateRepository,
} from '@workspace/git-executor';
import {
  BYTES_NOTIFICATION,
  MachineProtocolError,
  type JsonValue,
} from '@workspace/machine-protocol';
import {
  createFile,
  editFile,
  readResolvedFile,
  replaceFile,
  statHostPath,
} from '@workspace/native-file-tools';
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
} from '@workspace/runtime-safety';
import { z } from 'zod';

import { MachineConnector } from '../machines/machine-connector.service';
import type { MachineRequestOptions } from '../machines/machine-session';
import type { MachineTransportFactory } from '../machines/machine-transport';
import { DEFAULT_LOCAL_MACHINE_NAME } from './local-machine';
import {
  createProtocolPeer,
  type PeerCall,
  type PeerSession,
  type ProtocolPeer,
  type ProtocolPeerOptions,
  wireJson,
} from './machine-protocol-peer';

export type MachineFilesCall = PeerCall;
export type MachineFilesSession = Pick<PeerSession, 'requests' | 'calls'>;

export type MachineFilesPeer = {
  readonly sessions: ReadonlyArray<MachineFilesSession>;
  session(index: number): Promise<MachineFilesSession>;
};

export type MachineFilesPeerOptions = Pick<
  ProtocolPeerOptions,
  'roots' | 'onNotification'
> & {
  readonly name?: string;
  readonly onRequest?: (method: string) => void;
};

export type MachineFilesConnector = MachineConnector & {
  readonly peer: MachineFilesPeer;
};

const displayOptionsSchema = z.object({
  displayPrefix: z.string().optional(),
  selector: z.string().optional(),
  reserveCodeUnits: z.number().optional(),
});
const pathParamsSchema = z.object({
  path: z.string(),
  options: displayOptionsSchema.optional(),
});
const editParamsSchema = pathParamsSchema.extend({
  oldText: z.string(),
  newText: z.string(),
});
const writeParamsSchema = pathParamsSchema.extend({
  content: z.string(),
  replace: z.boolean().optional(),
});
const bytesParamsSchema = z.object({ path: z.string() });
const serverParamsSchema = z.object({ root: z.string() });
const mcpConfigSchema = z.object({
  mcpServers: z.record(
    z.string(),
    z.object({ type: z.enum(['stdio', 'http']).optional() }),
  ),
});
const gitOptionsSchema = displayOptionsSchema;
const gitPathParamsSchema = z.object({
  path: z.string(),
  options: gitOptionsSchema.optional(),
});
const gitStateParamsSchema = z.object({
  path: z.string(),
  gitEntry: z.string(),
  limit: z.number().int(),
  submodules: z.enum(['skip', 'check']),
  timeoutMs: z.number().optional(),
  options: gitOptionsSchema.optional(),
});
const gitAddParamsSchema = z.object({
  source: z.string(),
  branch: z.string(),
  baseRef: z.string().optional(),
  directory: z.string(),
  options: gitOptionsSchema.optional(),
});
const gitListParamsSchema = z.object({
  source: z.string(),
  options: gitOptionsSchema.optional(),
});
const pathFields: Record<string, true> = {
  path: true,
  toplevel: true,
  commonDir: true,
  mainWorktree: true,
  gitEntry: true,
};

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || isBoolean(value) || isNumber(value) || isString(value))
    return true;

  if (Array.isArray(value)) return value.every(isJsonValue);

  if (!isRecord(value)) return false;

  return Object.values(value).every(
    (entry) => entry === undefined || isJsonValue(entry),
  );
}

function mapGitPaths(value: JsonValue, prefix: string | undefined): JsonValue {
  if (prefix === undefined) return value;

  if (Array.isArray(value))
    return value.map((entry) => mapGitPaths(entry, prefix));

  if (!isRecord(value)) return value;

  const mapped: Record<string, JsonValue | undefined> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (!isJsonValue(entry)) continue;

    if (key in pathFields && isString(entry) && entry.startsWith('/'))
      mapped[key] = `${prefix}${entry}`;
    else mapped[key] = mapGitPaths(entry, prefix);
  }

  return mapped;
}

function mappedGitResult(
  result: JsonValue,
  options: z.infer<typeof gitOptionsSchema> | undefined,
): JsonValue {
  return mapGitPaths(result, options?.displayPrefix);
}

async function answerGitCall(
  call: PeerCall,
  roots: ReadonlyArray<string>,
): Promise<JsonValue | undefined> {
  if (!call.method.startsWith('git.')) return undefined;
  if (call.method === 'git.inspect' || call.method === 'git.locate') {
    const params = gitPathParamsSchema.safeParse(call.params);

    if (!params.success)
      return failure('invalid_input', 'A host path is required.');

    const path = await guardedPath(params.data.path, roots);

    if (path === undefined) pathNotRegistered();

    const result =
      call.method === 'git.inspect'
        ? await inspectRepository({ path })
        : await locateRepository({ path });

    return mappedGitResult(wireJson(result), params.data.options);
  }

  if (call.method === 'git.state') {
    const params = gitStateParamsSchema.safeParse(call.params);

    if (!params.success)
      return failure('invalid_input', 'Git state parameters are required.');

    const path = await guardedPath(params.data.path, roots);
    const gitEntry = await guardedPath(params.data.gitEntry, roots);

    if (path === undefined || gitEntry === undefined) pathNotRegistered();

    const result = await stateRepository(
      {
        path,
        gitEntry,
        limit: params.data.limit,
        submodules: params.data.submodules,
      },
      { timeoutMs: params.data.timeoutMs },
    );

    return mappedGitResult(wireJson(result), params.data.options);
  }

  if (call.method === 'git.worktreeAdd') {
    const params = gitAddParamsSchema.safeParse(call.params);

    if (!params.success)
      return failure('invalid_input', 'Worktree parameters are required.');

    const source = await guardedPath(params.data.source, roots);
    const directory = await guardedPath(params.data.directory, roots);

    if (source === undefined || directory === undefined) pathNotRegistered();

    const result = await addWorktree({
      source,
      branch: params.data.branch,
      directory,
      ...(params.data.baseRef === undefined
        ? {}
        : { baseRef: params.data.baseRef }),
    });

    return mappedGitResult(wireJson(result), params.data.options);
  }

  if (call.method === 'git.worktreeList') {
    const params = gitListParamsSchema.safeParse(call.params);

    if (!params.success)
      return failure('invalid_input', 'A worktree source is required.');

    const source = await guardedPath(params.data.source, roots);

    if (source === undefined) pathNotRegistered();

    return mappedGitResult(
      wireJson(await listWorktrees({ path: source })),
      params.data.options,
    );
  }

  if (call.method === 'git.worktreeRemove') {
    const params = gitPathParamsSchema.safeParse(call.params);

    if (!params.success)
      return failure('invalid_input', 'A worktree path is required.');

    const path = await guardedPath(params.data.path, roots);

    if (path === undefined) pathNotRegistered();

    return mappedGitResult(
      wireJson(await removeWorktree({ path })),
      params.data.options,
    );
  }

  return undefined;
}

function displayPath(
  params: z.infer<typeof pathParamsSchema>,
  path: string,
): string {
  const prefix = params.options?.displayPrefix;

  return prefix === undefined ? path : `${prefix}${path}`;
}

function isWithinRoots(path: string, roots: ReadonlyArray<string>): boolean {
  return roots.some((root) => {
    const rel = relative(root, path);

    return (
      rel === '' ||
      (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
    );
  });
}

async function guardedPath(
  path: string,
  roots: ReadonlyArray<string>,
): Promise<string | undefined> {
  let canonical: string;

  try {
    canonical = await realpath(path);
  } catch {
    canonical = resolve(path);
  }

  if (!isWithinRoots(canonical, roots)) return undefined;

  return path.endsWith(sep) && canonical !== sep
    ? `${canonical}${sep}`
    : canonical;
}

function failure(type: string, message: string): JsonValue {
  return { status: 'error', type, message };
}

function pathNotRegistered(): never {
  throw new MachineProtocolError(
    'path_not_registered',
    'The path is outside every root registered on this Machine.',
  );
}

async function answerStat(
  params: z.infer<typeof pathParamsSchema>,
): Promise<JsonValue> {
  const result = await statHostPath(params.path);
  let isLink = false;

  try {
    isLink = (await lstat(params.path)).isSymbolicLink();
  } catch {}

  if (result.kind === 'missing') return wireJson({ kind: result.kind, isLink });

  return wireJson({
    kind: result.kind,
    size: result.size,
    realPath: displayPath(params, result.canonicalPath),
    isLink,
  });
}

async function answerList(
  params: z.infer<typeof pathParamsSchema>,
): Promise<JsonValue> {
  const entries = await readdir(params.path, { withFileTypes: true });
  const sorted = entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const limited = sorted.slice(0, 1000).map((entry) => ({
    name: entry.name,
    kind: entry.isDirectory()
      ? 'directory'
      : entry.isFile()
        ? 'file'
        : entry.isSymbolicLink()
          ? 'link'
          : 'other',
  }));

  return wireJson({
    entries: limited,
    totalCount: sorted.length,
    truncated: sorted.length > limited.length,
  });
}

async function answerRead(
  params: z.infer<typeof pathParamsSchema>,
): Promise<JsonValue> {
  const handle = await open(params.path, 'r');
  const signature = Buffer.alloc(12);

  try {
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    const mediaType = byteMediaType(signature.subarray(0, bytesRead));

    if (mediaType !== 'application/octet-stream')
      return failure('invalid_utf8', 'The file contains binary media.');
  } finally {
    await handle.close();
  }

  return wireJson(
    await readResolvedFile(params.path, {
      displayPath: displayPath(params, params.path),
      ...(params.options?.selector === undefined
        ? {}
        : { selector: params.options.selector }),
      ...(params.options?.reserveCodeUnits === undefined
        ? {}
        : { reserveCodeUnits: params.options.reserveCodeUnits }),
      followSymlinks: true,
    }),
  );
}

async function answerEdit(
  params: z.infer<typeof editParamsSchema>,
): Promise<JsonValue> {
  const result = await editFile(
    { path: params.path, oldText: params.oldText, newText: params.newText },
    undefined,
    {
      displayPath: displayPath(params, params.path),
      ...(params.options?.reserveCodeUnits === undefined
        ? {}
        : { reserveCodeUnits: params.options.reserveCodeUnits }),
    },
  );

  return wireJson(result);
}

async function answerWrite(
  params: z.infer<typeof writeParamsSchema>,
): Promise<JsonValue> {
  const mutationOptions = {
    displayPath: displayPath(params, params.path),
    ...(params.options?.reserveCodeUnits === undefined
      ? {}
      : { reserveCodeUnits: params.options.reserveCodeUnits }),
  };
  const input = { path: params.path, content: params.content };

  if (params.replace === true)
    return wireJson(await replaceFile(input, undefined, mutationOptions));

  await mkdir(dirname(params.path), { recursive: true });

  return wireJson(await createFile(input, undefined, mutationOptions));
}

async function answerFileMethod(
  call: PeerCall,
  params: z.infer<typeof pathParamsSchema>,
): Promise<JsonValue> {
  try {
    if (call.method === 'fs.stat') return answerStat(params);

    if (call.method === 'fs.list') return answerList(params);

    if (call.method === 'fs.read') return answerRead(params);

    if (call.method === 'fs.edit') {
      const parsed = editParamsSchema.safeParse(call.params);

      if (!parsed.success)
        return failure('invalid_input', 'Old and new text are required.');

      return answerEdit({ ...parsed.data, path: params.path });
    }

    if (call.method === 'fs.write') {
      const parsed = writeParamsSchema.safeParse(call.params);

      if (!parsed.success)
        return failure('invalid_input', 'File content is required.');

      return answerWrite({ ...parsed.data, path: params.path });
    }

    return failure(
      'invalid_input',
      `${call.method} is not implemented by this file peer.`,
    );
  } catch (error) {
    if (error instanceof MachineProtocolError) throw error;

    return failure(
      'not_found',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function byteMediaType(bytes: Buffer): string {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
    return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('ascii') === '%PDF')
    return 'application/pdf';

  return 'application/octet-stream';
}

async function answerBytes(
  params: z.infer<typeof bytesParamsSchema>,
  notify: (notification: {
    readonly method: string;
    readonly params?: JsonValue;
  }) => void,
): Promise<JsonValue> {
  const bytes = await readFile(params.path);

  for (
    let offset = 0, sequence = 0;
    offset < bytes.length;
    offset += 64 * 1024
  ) {
    notify({
      method: BYTES_NOTIFICATION,
      params: {
        seq: sequence,
        data: bytes.subarray(offset, offset + 64 * 1024).toString('base64'),
      },
    });
    sequence += 1;
  }

  return wireJson({ size: bytes.length, mediaType: byteMediaType(bytes) });
}

async function answerMcpServers(
  params: z.infer<typeof serverParamsSchema>,
  roots: ReadonlyArray<string>,
): Promise<JsonValue> {
  const root = await guardedPath(params.root, roots);

  if (root === undefined) pathNotRegistered();

  const content = await readFile(resolve(root, '.mcp.json'), 'utf8');
  const config = mcpConfigSchema.parse(JSON.parse(content));
  const servers = Object.entries(config.mcpServers).map(([name, server]) => ({
    name,
    state: 'available',
    ...(server.type === undefined ? {} : { transport: server.type }),
  }));

  return wireJson({ servers });
}

async function answerFileCall(
  call: PeerCall,
  options: MachineFilesPeerOptions,
  notify: (notification: {
    readonly method: string;
    readonly params?: JsonValue;
  }) => void,
): Promise<JsonValue> {
  options.onRequest?.(call.method);

  const roots = options.roots ?? ['/'];

  if (call.method === 'roots.list') return wireJson({ roots });

  if (call.method === 'mcp.servers') {
    const params = serverParamsSchema.safeParse(call.params);

    if (!params.success)
      return failure('invalid_input', 'A host root is required.');

    return answerMcpServers(params.data, roots);
  }

  const gitResult = await answerGitCall(call, roots);

  if (gitResult !== undefined) return gitResult;

  if (call.method === 'fs.bytes') {
    const params = bytesParamsSchema.safeParse(call.params);

    if (!params.success)
      return failure('invalid_input', 'A host path is required.');

    const path = await guardedPath(params.data.path, roots);

    if (path === undefined) pathNotRegistered();

    return answerBytes({ path }, notify);
  }

  const parsed = pathParamsSchema.safeParse(call.params);

  if (!parsed.success)
    return failure('invalid_input', 'A host path is required.');

  const path = await guardedPath(parsed.data.path, roots);

  if (path === undefined) pathNotRegistered();

  return answerFileMethod(call, { ...parsed.data, path });
}

function createFilePeer(options: MachineFilesPeerOptions): ProtocolPeer {
  return createProtocolPeer({
    roots: options.roots ?? ['/'],
    onNotification: options.onNotification,
    answer: async (call, _requestOptions, notify) => ({
      value: await answerFileCall(call, options, notify),
    }),
  });
}

export function machineFilesTransportFactory(
  options: Pick<MachineFilesPeerOptions, 'roots' | 'onRequest'> = {},
): MachineTransportFactory {
  return createFilePeer(options).factory;
}

export function machineFilesConnector(
  options: MachineFilesPeerOptions = {},
): MachineFilesConnector {
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
