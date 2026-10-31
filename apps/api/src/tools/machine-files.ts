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
  type NativeLineRange,
  type NativeMutationDisplay,
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
import { type MachineConnector } from '../machines/machine-connector.service';
import { boundMachineRoots } from '../machines/machines-status';
import { type ToolMediaStore } from '../media/tool-media-store';
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
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

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
  if (!isString(value)) return undefined;
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
    !isString(content) ||
    !isString(reportedPath)
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
  const store = context.media;
  if (connector === undefined || store === undefined) return undefined;
  const { raw, bytes } = await readMachineBytes(
    context,
    connector,
    machine,
    envelope,
  );
  const meta = readFsBytesResult(raw);
  if (meta === undefined) return machineUnusableResult(machine.name);
  if ('status' in meta) return meta;
  if (bytes.byteLength !== meta.size)
    return machineUnusableResult(machine.name);
  const locator = formatMachineLocator(machine.name, machine.path);
  if (locator === undefined) return machineUnusableResult(machine.name);
  return handMachineBytes(context, store, {
    bytes,
    locator,
    selector: machine.selector,
    submitted,
  });
}

/** The bytes of one Machine media read, as the shared media store takes them. */
type MachineMediaBytes = {
  readonly bytes: Buffer;
  readonly locator: string;
  readonly selector: string | undefined;
  readonly submitted: string;
};

/**
 * Hand the streamed bytes to the shared byte-buffer preparation. A refusal the
 * preparation itself makes (an unsupported media type, an over-large image) is
 * this read's result, exactly as it would be for the same local file.
 */
async function handMachineBytes(
  context: ToolContext,
  store: ToolMediaStore,
  media: MachineMediaBytes,
): Promise<ToolResult | undefined> {
  try {
    return await readMediaBytes(
      media.bytes,
      {
        path: media.locator,
        ...(media.selector !== undefined && { selector: media.selector }),
      },
      {
        media: store.readMedia(media.submitted, context.toolCallId),
        signal: context.abortSignal,
      },
    );
  } catch (error) {
    if (error instanceof NativeFileError)
      return { status: 'error', type: error.type, message: error.message };
    throw error;
  }
}

/**
 * One `fs.bytes` exchange: the streamed chunks and the result the daemon
 * answered with. The channel is closed as soon as the result settles, whatever
 * it is, so a failed read never leaves a stream open.
 */
async function readMachineBytes(
  context: ToolContext,
  connector: MachineConnector,
  machine: MachinePath,
  envelope: RequestEnvelope,
): Promise<{ readonly raw: JsonValue; readonly bytes: Buffer }> {
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
  return { raw, bytes: Buffer.concat(chunks) };
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
  return runMachineMutation(
    context,
    {
      name: machine.name,
      operation: call.operation,
      locator: machinePathLocator(machine),
    },
    async () => {
      const raw = await requestMachineMutation(context, connector, call, {
        machine,
        envelope,
      });
      const result = readFsMutateResult(raw, call);
      return result === undefined
        ? machineUnusableResult(machine.name)
        : canonicalizeMachineResult(machine, result);
    },
  );
}

/** The addressing and budget one Machine mutation request carries. */
type MachineMutationRequest = {
  readonly machine: MachinePath;
  readonly envelope: RequestEnvelope;
};

/** One `fs.edit` or `fs.write` request, whichever the machine call asked for. */
function requestMachineMutation(
  context: ToolContext,
  connector: MachineConnector,
  call: Exclude<MachineFileCall, { operation: 'read' }>,
  request: MachineMutationRequest,
): Promise<JsonValue> {
  const { machine, envelope } = request;
  const options = { displayPrefix: machinePrefix(machine.name) };
  return call.operation === 'edit'
    ? connector.request(
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
    : connector.request(
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
}

/** One stored line range from a daemon answer: both counts, or nothing. */
function readMutationRange(value: unknown): NativeLineRange | undefined {
  if (!isRecord(value)) return undefined;
  const { startLine, endLine } = value;
  return isNumber(startLine) && isNumber(endLine)
    ? { startLine, endLine }
    : undefined;
}

/** The edit input a Machine edit call carries. */
type MachineEditInput = Extract<
  MachineFileCall,
  { operation: 'edit' }
>['input'];

/** The display data of an edit answer: the daemon's start line with the text
 *  the hub already holds. A daemon answers without the replaced and
 *  replacement text, because echoing a large replacement would carry it over
 *  the frame limit twice and can fail after the file has changed, so the
 *  stored part takes `oldText` and `newText` from the call, exactly as a local
 *  edit takes them from its input. */
function readMutationDisplay(
  value: unknown,
  input: MachineEditInput,
): NativeMutationDisplay | undefined {
  if (!isRecord(value)) return undefined;
  const { startLine } = value;
  return isNumber(startLine)
    ? { startLine, oldText: input.oldText, newText: input.newText }
    : undefined;
}

/** One `fs.write` success: only the facts its status line names. An old
 *  daemon's `content`, `shownRange`, and `truncated` belong to the edit form
 *  and would contradict the write contract, so they are dropped, never
 *  stored. */
function readFsWriteResult(
  value: UnknownRecord,
  path: string,
): NativeMutationResult {
  const { created, replaced, lineCount } = value;
  return {
    status: 'success',
    operation: 'write',
    path,
    ...(created === true && { created: true }),
    ...(replaced === true && { replaced: true }),
    ...(isNumber(lineCount) && { lineCount }),
  };
}

/** One `fs.edit` success: its numbered region, shown range, cut marker, line
 *  count, and display data. An old-daemon edit without display data keeps its
 *  `diff`, which is the only line numbering the owner UI has for such a part;
 *  a current answer's display data makes the diff dead weight. Each field is
 *  forwarded only when it is well formed. */
function readFsEditResult(
  value: UnknownRecord,
  path: string,
  input: MachineEditInput | undefined,
): NativeMutationResult {
  const { content, truncated, replacements, lineCount } = value;
  const storedRange = value['shownRange'];
  const shownRange =
    storedRange === null ? null : readMutationRange(storedRange);
  const display =
    input === undefined
      ? undefined
      : readMutationDisplay(value['display'], input);
  const legacyDiff =
    display === undefined && isString(value['diff'])
      ? value['diff']
      : undefined;
  return {
    status: 'success',
    operation: 'edit',
    path,
    ...(replacements === 1 && { replacements: 1 }),
    ...(isString(content) && { content }),
    ...(shownRange !== undefined && { shownRange }),
    ...(isBoolean(truncated) && { truncated }),
    ...(isNumber(lineCount) && { lineCount }),
    ...(display !== undefined && { display }),
    ...(legacyDiff !== undefined && { diff: legacyDiff }),
  };
}

/**
 * One `fs.edit` or `fs.write` success, mapped to the shape the tool stores. A
 * write is status only; an edit carries its region and the display data the
 * owner UI diffs. A daemon that predates a field still yields a usable result.
 */
function readFsMutateResult(
  value: JsonValue,
  call: Exclude<MachineFileCall, { operation: 'read' }>,
): ToolResult | undefined {
  const failure = readNativeFailure(value);
  if (failure !== undefined) return failure;
  if (!isRecord(value) || value['status'] !== 'success') return undefined;
  const { operation, path } = value;
  if ((operation !== 'edit' && operation !== 'write') || !isString(path))
    return undefined;
  return operation === 'write'
    ? readFsWriteResult(value, path)
    : readFsEditResult(
        value,
        path,
        call.operation === 'edit' ? call.input : undefined,
      );
}
