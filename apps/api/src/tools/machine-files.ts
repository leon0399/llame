/**
 * The `machine://` branch of the native file tools: reads, both listing forms,
 * and the mutations, all executed on the Machine through `MachineConnector`.
 * Every reported path is the Machine locator the daemon renders from the
 * `displayPrefix` supplied here, so a host path never crosses back to the
 * model, and a Machine operation never binds the Run to the local executor.
 */

import {
  BYTES_NOTIFICATION,
  type JsonValue,
  type NativeMutationResult,
  type RequestEnvelope,
} from '@workspace/machine-protocol';
import {
  formatMachineLocator,
  MACHINE_SCHEME,
  parseMachineLocator,
  type MachineLocator,
} from '../machines/machine-locator';
import {
  readFsBytesResult,
  readFsReadResult,
  readNativeFailure,
  readRootsListResult,
} from '../machines/machine-results';
import { boundMachineRoots } from '../machines/machines-status';
import {
  MACHINE_FILE_BUDGET_MS,
  machineBudgetMs,
  machineCallEnvelope,
  machineConnector,
  machineNotFoundResult,
  machineReadResult,
  machineUnusableResult,
  readBytesChunk,
  runMachineMutation,
} from './machine-call';
import { type ToolContext, type ToolResult } from './types';
import { NativeFileError, readMediaBytes } from '@workspace/native-file-tools';
import { isRecord, isString } from '@workspace/runtime-safety';

/** The three native calls a Machine locator can address. */
export type MachineFileCall =
  | { readonly operation: 'read'; readonly input: { readonly path: string } }
  | {
      readonly operation: 'edit';
      readonly input: {
        readonly path: string;
        readonly oldText: string;
        readonly newText: string;
      };
    }
  | {
      readonly operation: 'write';
      readonly input: {
        readonly path: string;
        readonly content: string;
        readonly replace?: boolean;
      };
    };

type MachinePath = Extract<MachineLocator, { kind: 'path' }>;

/**
 * One native call whose path is a `machine://` locator. `submitted` is the
 * text the model wrote, which is the key an image read is held under; the
 * locator itself is split into its Machine name, absolute path, and selector.
 */
export function executeMachineNative(
  context: ToolContext,
  call: MachineFileCall,
  submitted: string,
): Promise<ToolResult> {
  if (machineConnector(context) === undefined)
    return Promise.resolve(unknownSchemeResult());
  const locator = parseMachineLocator(call.input.path);
  if (locator.kind === 'invalid')
    return Promise.resolve({
      status: 'error',
      type: 'invalid_path',
      message: locator.message,
    });
  if (locator.kind !== 'path')
    return call.operation === 'read'
      ? machineListing(context, locator)
      : Promise.resolve(listingMutationResult());
  if (call.operation !== 'read' && locator.selector !== undefined)
    return Promise.resolve(selectorOnMutationResult());
  return call.operation === 'read'
    ? readMachinePath(context, locator, submitted)
    : mutateMachinePath(context, call, locator);
}

/** The display prefix and canonical locator every request for one path uses. */
function machinePrefix(name: string): string {
  return `${MACHINE_SCHEME}://${name}`;
}

function machinePathLocator(machine: MachinePath): string {
  return (
    formatMachineLocator(machine.name, machine.path) ??
    `${machinePrefix(machine.name)}${machine.path}`
  );
}

/**
 * The path a Machine result reported, re-encoded once. The daemon concatenates
 * its display prefix onto the raw absolute path, so a filename containing `#`
 * arrives unescaped; re-encoding here is what makes the reported locator
 * round-trip. A path that does not carry this Machine's prefix is not a locator
 * this hub asked for and is dropped rather than reported.
 */
function canonicalReportedPath(
  name: string,
  value: unknown,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const prefix = machinePrefix(name);
  if (!value.startsWith(prefix)) return undefined;
  return formatMachineLocator(name, value.slice(prefix.length)) ?? undefined;
}

/**
 * Every path a Machine operation reports is a canonical Machine locator. A
 * directory read also carries its header inside `content`, which is the display
 * path the daemon rendered, so that one occurrence is re-encoded too; file
 * content is never rewritten.
 */
function canonicalizeMachineResult(
  machine: MachinePath,
  result: ToolResult,
): ToolResult {
  if (result.status !== 'success') return result;
  const path = canonicalReportedPath(machine.name, result['path']);
  const realPath = canonicalReportedPath(machine.name, result['realPath']);
  const canonical: ToolResult = {
    ...result,
    path: path ?? machinePathLocator(machine),
    ...(realPath !== undefined && { realPath }),
  };
  const content = result['content'];
  const reportedPath = canonical['path'];
  if (
    result['kind'] !== 'directory' ||
    typeof content !== 'string' ||
    typeof reportedPath !== 'string'
  )
    return canonical;
  const header = `${machinePrefix(machine.name)}${machine.path}`;
  return {
    ...canonical,
    content: content.split(header).join(reportedPath),
  };
}

function unknownSchemeResult(): ToolResult {
  return {
    status: 'error',
    type: 'invalid_path',
    message: 'This path scheme is not available.',
  };
}

function listingMutationResult(): ToolResult {
  return {
    status: 'error',
    type: 'unsupported_operation',
    message: 'A Machine listing is read-only; edit and write cannot target it.',
  };
}

function selectorOnMutationResult(): ToolResult {
  return {
    status: 'error',
    type: 'invalid_selector',
    message: 'A line selector cannot be used with edit or write.',
  };
}

/**
 * A bare `machine://` lists every configured Machine with its status, and
 * `machine://<name>` lists that Machine's registered roots. Both are reads:
 * the mutation forms are refused before any request.
 */
function machineListing(
  context: ToolContext,
  locator: Extract<MachineLocator, { kind: 'list' | 'roots' }>,
): Promise<ToolResult> {
  const connector = machineConnector(context);
  if (connector === undefined) return Promise.resolve(unknownSchemeResult());
  if (locator.kind === 'list') return configuredMachines(context);
  if (!connector.isConfigured(locator.name))
    return Promise.resolve(machineNotFoundResult(locator.name));
  const name = locator.name;
  return machineReadResult(name, async () => {
    const raw = await connector.request(
      name,
      'roots.list',
      {
        envelope: machineCallEnvelope(
          context,
          machineBudgetMs(context, MACHINE_FILE_BUDGET_MS),
        ),
      },
      { signal: context.abortSignal },
    );
    const result = readRootsListResult(raw);
    if (result === undefined) return machineUnusableResult(name);
    const roots = boundMachineRoots(result.roots);
    const lines = roots.map((root) => {
      const location =
        formatMachineLocator(name, root) ?? `${machinePrefix(name)}${root}`;
      return `- ${location}${root.endsWith('/') ? '' : '/'}`;
    });
    return listingResult(
      machinePrefix(name),
      lines.length === 0 ? ['(no registered roots)'] : lines,
    );
  });
}

/**
 * The configured Machines and their derived status. The status read model is
 * owner-scoped and never names an SSH route, a jump host, or an identity; a
 * context without it still lists the names, without a status.
 */
async function configuredMachines(context: ToolContext): Promise<ToolResult> {
  const connector = machineConnector(context);
  if (connector === undefined) return unknownSchemeResult();
  const names = connector.names();
  const statuses = await context.machineStatus?.list(context.userId);
  const byName = new Map(
    (statuses ?? []).map((status) => [status.name, status]),
  );
  const lines = names.map((name) => {
    const status = byName.get(name);
    if (status === undefined) return `- ${machinePrefix(name)}`;
    const detail =
      status.status === 'online'
        ? 'online'
        : status.failureReason === null
          ? 'offline'
          : `offline, ${status.failureReason}`;
    return `- ${machinePrefix(name)} (${detail})`;
  });
  return listingResult(
    `${MACHINE_SCHEME}://`,
    lines.length === 0 ? ['(no Machines configured)'] : lines,
  );
}

function listingResult(path: string, lines: ReadonlyArray<string>): ToolResult {
  return {
    status: 'success',
    kind: 'directory',
    path,
    content: lines.join('\n'),
    truncated: false,
  };
}

async function readMachinePath(
  context: ToolContext,
  machine: MachinePath,
  submitted: string,
): Promise<ToolResult> {
  const connector = machineConnector(context);
  if (connector === undefined) return unknownSchemeResult();
  if (!connector.isConfigured(machine.name))
    return machineNotFoundResult(machine.name);
  const envelope = machineCallEnvelope(
    context,
    machineBudgetMs(context, MACHINE_FILE_BUDGET_MS),
  );
  return machineReadResult(machine.name, async () => {
    const raw = await connector.request(
      machine.name,
      'fs.read',
      {
        envelope,
        path: machine.path,
        options: {
          displayPrefix: machinePrefix(machine.name),
          ...(machine.selector !== undefined && {
            selector: machine.selector,
          }),
        },
      },
      { signal: context.abortSignal },
    );
    const result = readFsReadResult(raw);
    if (result === undefined) return machineUnusableResult(machine.name);
    if (result.status === 'success')
      return canonicalizeMachineResult(machine, { ...result });
    // The daemon reads text only; bytes of an image or PDF are not valid UTF-8
    // here, and the media path streams them instead. Any other refusal is the
    // read's own result.
    if (result.type !== 'invalid_utf8' || context.media === undefined)
      return result;
    return (
      (await readMachineMedia(context, machine, submitted, envelope)) ?? result
    );
  });
}

/**
 * The media read of a Machine file, through `fs.bytes` and the shared
 * byte-buffer preparation, so the result is the one a local read of the same
 * bytes produces. `undefined` means the bytes are not an image or PDF after
 * all, and the text read's refusal stands.
 */
async function readMachineMedia(
  context: ToolContext,
  machine: MachinePath,
  submitted: string,
  envelope: RequestEnvelope,
): Promise<ToolResult | undefined> {
  const connector = machineConnector(context);
  const media = context.media;
  if (connector === undefined || media === undefined) return undefined;
  const handle = await connector.openChannel(
    machine.name,
    'fs.bytes',
    { envelope, path: machine.path },
    { signal: context.abortSignal },
  );
  const chunks: Array<Buffer> = [];
  handle.channel.onNotification((message) => {
    if (message.method !== BYTES_NOTIFICATION) return;
    const chunk = readBytesChunk(message.params);
    if (chunk !== undefined) chunks.push(chunk);
  });
  let raw: JsonValue;
  try {
    raw = await handle.result;
  } finally {
    handle.channel.close();
  }
  const meta = readFsBytesResult(raw);
  if (meta === undefined) return machineUnusableResult(machine.name);
  if ('status' in meta) return meta;
  const bytes = Buffer.concat(chunks);
  if (bytes.byteLength !== meta.size)
    return machineUnusableResult(machine.name);
  const locator = formatMachineLocator(machine.name, machine.path);
  if (locator === undefined) return machineUnusableResult(machine.name);
  try {
    return await readMediaBytes(
      bytes,
      {
        path: locator,
        ...(machine.selector !== undefined && {
          selector: machine.selector,
        }),
      },
      {
        media: media.readMedia(submitted, context.toolCallId),
        signal: context.abortSignal,
      },
    );
  } catch (error) {
    if (error instanceof NativeFileError)
      return { status: 'error', type: error.type, message: error.message };
    throw error;
  }
}

async function mutateMachinePath(
  context: ToolContext,
  call: Exclude<MachineFileCall, { operation: 'read' }>,
  machine: MachinePath,
): Promise<ToolResult> {
  const connector = machineConnector(context);
  if (connector === undefined) return unknownSchemeResult();
  if (!connector.isConfigured(machine.name))
    return machineNotFoundResult(machine.name);
  const envelope = machineCallEnvelope(
    context,
    machineBudgetMs(context, MACHINE_FILE_BUDGET_MS),
  );
  const options = { displayPrefix: machinePrefix(machine.name) };
  return runMachineMutation(
    context,
    {
      name: machine.name,
      operation: call.operation,
      locator: machinePathLocator(machine),
    },
    async () => {
      const raw =
        call.operation === 'edit'
          ? await connector.request(
              machine.name,
              'fs.edit',
              {
                envelope,
                path: machine.path,
                options,
                oldText: call.input.oldText,
                newText: call.input.newText,
              },
              { signal: context.abortSignal },
            )
          : await connector.request(
              machine.name,
              'fs.write',
              {
                envelope,
                path: machine.path,
                options,
                content: call.input.content,
                ...(call.input.replace === true && { replace: true }),
              },
              { signal: context.abortSignal },
            );
      const result = readFsMutateResult(raw);
      return result === undefined
        ? machineUnusableResult(machine.name)
        : canonicalizeMachineResult(machine, result);
    },
  );
}

function readFsMutateResult(value: JsonValue): ToolResult | undefined {
  const failure = readNativeFailure(value);
  if (failure !== undefined) return failure;
  if (!isRecord(value) || value['status'] !== 'success') return undefined;
  const { operation, path, diff, content, truncated } = value;
  if (
    (operation !== 'edit' && operation !== 'write') ||
    !isString(path) ||
    !isString(diff) ||
    !isString(content) ||
    typeof truncated !== 'boolean'
  )
    return undefined;
  const result: NativeMutationResult = {
    status: 'success',
    operation,
    path,
    diff,
    content,
    truncated,
  };
  if (value['created'] === true) return { ...result, created: true };
  if (value['replaced'] === true) return { ...result, replaced: true };
  return result;
}
