import {
  addWorktree,
  inspectRepository,
  listWorktrees,
  locateRepository,
  removeWorktree,
  stateRepository,
} from '@workspace/git-executor';
import {
  MachineProtocolError,
  type JsonValue,
} from '@workspace/machine-protocol';
import { isString } from '@workspace/runtime-safety';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';
import { z } from 'zod';

import type { PeerCall } from './machine-protocol-peer';
import { wireJson } from './machine-protocol-peer';

const gitOptionsSchema = z.object({ displayPrefix: z.string().optional() });

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

const pathFields = {
  path: true,
  toplevel: true,
  commonDir: true,
  mainWorktree: true,
  gitEntry: true,
} satisfies Record<string, true>;

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

function mapGitPaths(value: JsonValue, prefix: string | undefined): JsonValue {
  if (prefix === undefined) return value;

  const array = z.array(jsonValueSchema).safeParse(value);

  if (array.success)
    return array.data.map((entry) => mapGitPaths(entry, prefix));

  const record = z.record(z.string(), jsonValueSchema).safeParse(value);

  if (!record.success) return value;

  const mapped: Record<string, JsonValue | undefined> = {};

  for (const [key, entry] of Object.entries(record.data)) {
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

function pathNotRegistered(): never {
  throw new MachineProtocolError(
    'path_not_registered',
    'The path is outside every root registered on this Machine.',
  );
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

  if (
    !roots.some((root) => {
      const rel = relative(root, canonical);

      return (
        rel === '' ||
        (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
      );
    })
  )
    return undefined;

  return path.endsWith(sep) && canonical !== sep
    ? `${canonical}${sep}`
    : canonical;
}

export async function answerGitCall(
  call: PeerCall,
  roots: ReadonlyArray<string>,
): Promise<JsonValue | undefined> {
  if (!call.method.startsWith('git.')) return undefined;

  if (call.method === 'git.inspect' || call.method === 'git.locate')
    return inspectOrLocate(call, roots);

  if (call.method === 'git.state') return gitState(call, roots);

  if (call.method === 'git.worktreeAdd') return gitWorktreeAdd(call, roots);

  if (call.method === 'git.worktreeList') return gitWorktreeList(call, roots);

  if (call.method === 'git.worktreeRemove')
    return gitWorktreeRemove(call, roots);

  return undefined;
}

async function inspectOrLocate(
  call: PeerCall,
  roots: ReadonlyArray<string>,
): Promise<JsonValue> {
  const params = gitPathParamsSchema.safeParse(call.params);

  if (!params.success)
    return {
      status: 'error',
      type: 'invalid_input',
      message: 'A host path is required.',
    };

  const path = await guardedPath(params.data.path, roots);

  if (path === undefined) pathNotRegistered();

  const result =
    call.method === 'git.inspect'
      ? await inspectRepository({ path })
      : await locateRepository({ path });

  return mappedGitResult(wireJson(result), params.data.options);
}

async function gitState(
  call: PeerCall,
  roots: ReadonlyArray<string>,
): Promise<JsonValue> {
  const params = gitStateParamsSchema.safeParse(call.params);

  if (!params.success)
    return {
      status: 'error',
      type: 'invalid_input',
      message: 'Git state parameters are required.',
    };

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

async function gitWorktreeAdd(
  call: PeerCall,
  roots: ReadonlyArray<string>,
): Promise<JsonValue> {
  const params = gitAddParamsSchema.safeParse(call.params);

  if (!params.success)
    return {
      status: 'error',
      type: 'invalid_input',
      message: 'Worktree parameters are required.',
    };

  const source = await guardedPath(params.data.source, roots);
  const directory = await guardedPath(params.data.directory, roots);

  if (source === undefined || directory === undefined) pathNotRegistered();

  const input = {
    source,
    branch: params.data.branch,
    directory,
  };

  const result =
    params.data.baseRef === undefined
      ? await addWorktree(input)
      : await addWorktree({ ...input, baseRef: params.data.baseRef });

  return mappedGitResult(wireJson(result), params.data.options);
}

async function gitWorktreeList(
  call: PeerCall,
  roots: ReadonlyArray<string>,
): Promise<JsonValue> {
  const params = gitListParamsSchema.safeParse(call.params);

  if (!params.success)
    return {
      status: 'error',
      type: 'invalid_input',
      message: 'A worktree source is required.',
    };

  const source = await guardedPath(params.data.source, roots);

  if (source === undefined) pathNotRegistered();

  return mappedGitResult(
    wireJson(await listWorktrees({ path: source })),
    params.data.options,
  );
}

async function gitWorktreeRemove(
  call: PeerCall,
  roots: ReadonlyArray<string>,
): Promise<JsonValue> {
  const params = gitPathParamsSchema.safeParse(call.params);

  if (!params.success)
    return {
      status: 'error',
      type: 'invalid_input',
      message: 'A worktree path is required.',
    };

  const path = await guardedPath(params.data.path, roots);

  if (path === undefined) pathNotRegistered();

  return mappedGitResult(
    wireJson(await removeWorktree({ path })),
    params.data.options,
  );
}
