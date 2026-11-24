/**
 * The daemon read path of the `machine://` native tools: a text read whose
 * reported paths become canonical locators, and the streamed `fs.bytes` read
 * that serves an image or PDF through the shared media store, so its result is
 * the one a local read of the same bytes produces.
 */

import {
  BYTES_NOTIFICATION,
  type JsonValue,
  type NativeFailureResult,
} from '@workspace/machine-protocol';
import {
  formatMachineLocator,
  machinePrefix,
} from '../machines/machine-locator';
import {
  readFsBytesResult,
  readFsReadResult,
} from '../machines/machine-results';
import { type MachineConnector } from '../machines/machine-connector.service';
import { type ToolMediaStore } from '../media/tool-media-store';
import { type MachineRequestEnvelope } from '../machines/machine-session';
import {
  MACHINE_FILE_BUDGET_MS,
  machineBudgetMs,
  machineCallEnvelope,
  machineConnector,
  machineNotFoundResult,
  machineReadResult,
  machineUnusableResult,
  readBytesChunk,
} from './machine-call';
import { type ToolContext, type ToolResult } from './types';
import { NativeFileError, readMediaBytes } from '@workspace/native-file-tools';
import { MEDIA_REFUSAL } from '../media/media-ingest';
import {
  canonicalizeMachineResult,
  hideMalformedMachineFileSpelling,
  type MachinePath,
} from './machine-file-results';

/**
 * One read on a Machine through the connector its dispatcher already holds:
 * the text read, and the media read its `invalid_utf8` refusal falls back to.
 * Every reported path is a canonical Machine locator.
 */
export async function readMachinePath(
  context: ToolContext,
  connector: MachineConnector,
  machine: MachinePath,
  submitted: string,
): Promise<ToolResult> {
  if (!connector.isConfigured(machine.name))
    return machineNotFoundResult(machine.name);

  const envelope = machineCallEnvelope(
    context,
    machineBudgetMs(context, MACHINE_FILE_BUDGET_MS),
  );

  const request = {
    context,
    connector,
    machine,
    submitted,
    envelope,
  };

  return machineReadResult(machine.name, () =>
    readMachinePathResult(request),
  ).then((result) => hideMalformedMachineFileSpelling(machine.path, result));
}

type MachineReadRequest = {
  readonly context: ToolContext;
  readonly connector: MachineConnector;
  readonly machine: MachinePath;
  readonly submitted: string;
  readonly envelope: RequestEnvelope;
  readonly mediaMachine?: MachinePath;
};

/** Read a literal selector-suffixed filename before applying selector syntax. */
async function readMachinePathResult(
  request: MachineReadRequest,
): Promise<ToolResult> {
  const { machine } = request;

  if (machine.selector !== undefined) {
    const literal = {
      ...machine,
      path: `${machine.path}:${machine.selector}`,
      selector: undefined,
    };

    const result = await readMachineLiteralPath({
      ...request,
      machine: literal,
      mediaMachine: machine,
    });

    if (result !== undefined) return result;
  }

  return readMachineSelectedPath(request);
}

async function readMachineLiteralPath({
  context,
  connector,
  machine,
  submitted,
  envelope,
  mediaMachine,
}: MachineReadRequest): Promise<ToolResult | undefined> {
  const raw = await connector.request(
    machine.name,
    'fs.read',
    {
      envelope,
      path: machine.path,
      options: { displayPrefix: machinePrefix(machine.name) },
    },
    { signal: context.abortSignal },
  );

  const result = readFsReadResult(raw);

  if (result === undefined) return machineUnusableResult(machine.name);

  const settled = hideMalformedMachineFileSpelling(machine.path, result);

  if (settled.status === 'success')
    return canonicalizeMachineResult(machine, { ...settled });

  if (settled.type === 'not_found') return undefined;

  if (settled.type === 'invalid_utf8' && context.media !== undefined)
    return (
      (await readMachineMedia(
        context,
        mediaMachine ?? machine,
        submitted,
        envelope,
      )) ?? settled
    );

  return settled;
}

async function readMachineSelectedPath({
  context,
  connector,
  machine,
  submitted,
  envelope,
}: MachineReadRequest): Promise<ToolResult> {
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

  const settled = hideMalformedMachineFileSpelling(machine.path, result);

  if (settled.status === 'success')
    return canonicalizeMachineResult(machine, { ...settled });

  if (settled.type !== 'invalid_utf8' || context.media === undefined)
    return settled;

  return (
    (await readMachineMedia(context, machine, submitted, envelope)) ?? settled
  );
}

/**
 * The Machine media read streams bytes through the shared byte-buffer
 * preparation. The hub rejects bytes without an image or PDF signature as
 * unsupported media.
 * A literal filename that ends in a selector-shaped suffix is the target the
 * daemon's text read selected, because the literal-path probe takes precedence
 * over the selector split. Its bytes are asked for first, and the split
 * selector applies only to the path it was split from; a genuine media
 * selector is refused exactly as before.
 */
async function readMachineMedia(
  context: ToolContext,
  machine: MachinePath,
  submitted: string,
  envelope: MachineRequestEnvelope,
): Promise<ToolResult | undefined> {
  const connector = machineConnector(context);
  const store = context.media;

  if (connector === undefined || store === undefined) return undefined;

  const media: MachineMediaRead = {
    context,
    connector,
    store,
    envelope,
    submitted,
  };

  if (machine.selector !== undefined) {
    const literal = await machineMediaAttempt({
      ...media,
      machine: {
        ...machine,
        path: `${machine.path}:${machine.selector}`,
        selector: undefined,
      },
    });

    if (literal.status === 'settled') return literal.result;
  }

  const split = await machineMediaAttempt({ ...media, machine });

  return split.status === 'settled' ? split.result : split.failure;
}

/** One Machine media read's shared inputs. */
type MachineMediaRead = {
  readonly context: ToolContext;
  readonly connector: MachineConnector;
  readonly store: ToolMediaStore;
  readonly envelope: MachineRequestEnvelope;
  readonly submitted: string;
};

/** What one media attempt settled: a result, or no regular file to read. */
type MediaAttempt =
  | { readonly status: 'settled'; readonly result: ToolResult | undefined }
  | { readonly status: 'no_target'; readonly failure: NativeFailureResult };

/**
 * The bytes of one candidate target. A target that is not a regular file has
 * no bytes, so a literal filename that does not exist is the caller's cue to
 * try the split path; every other answer is the read's own.
 */
async function machineMediaAttempt(
  attempt: MachineMediaRead & { readonly machine: MachinePath },
): Promise<MediaAttempt> {
  const { context, connector, machine, envelope } = attempt;

  const { raw, bytes } = await readMachineBytes(
    context,
    connector,
    machine,
    envelope,
  );

  const meta = readFsBytesResult(raw);

  if (meta === undefined)
    return { status: 'settled', result: machineUnusableResult(machine.name) };

  if ('status' in meta) {
    const noTarget =
      meta.type === 'not_regular_file' || meta.type === 'not_found';

    // The wire handler refuses non-media after sniffing its bounded first chunk,
    // before it emits any bytes; the text read that asked for them stands.
    return noTarget
      ? { status: 'no_target', failure: meta }
      : {
          status: 'settled',
          result: meta.type === 'unsupported_media_type' ? undefined : meta,
        };
  }

  if (bytes.byteLength !== meta.size)
    return { status: 'settled', result: machineUnusableResult(machine.name) };
  const locator = formatMachineLocator(machine.name, machine.path);

  if (locator === undefined)
    return { status: 'settled', result: machineUnusableResult(machine.name) };

  return {
    status: 'settled',
    result: await handMachineBytes(context, attempt.store, {
      bytes,
      locator,
      selector: machine.selector,
      submitted: attempt.submitted,
    }),
  };
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
    const result = await readMediaBytes(
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

    return (
      result ?? {
        status: 'error',
        type: MEDIA_REFUSAL.unsupportedImage.code,
        message: MEDIA_REFUSAL.unsupportedImage.message,
      }
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
  envelope: MachineRequestEnvelope,
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
