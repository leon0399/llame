/**
 * The daemon read path of the `machine://` native tools: a text read whose
 * reported paths become canonical locators, and the streamed `fs.bytes` read
 * that serves an image or PDF through the shared media store, so its result is
 * the one a local read of the same bytes produces.
 */

import {
  BYTES_NOTIFICATION,
  type JsonValue,
  type RequestEnvelope,
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
import {
  canonicalizeMachineResult,
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

    // The daemon reads text only. Its media probe refuses an image or PDF by
    // signature before any decode, and bytes that are not UTF-8 refuse too:
    // the media path streams those bytes instead. Any other refusal is the
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

  // The daemon refuses bytes matching no image or PDF signature, so the text
  // read that asked for them is the read's result and none of them stream.
  if ('status' in meta)
    return meta.type === 'unsupported_media_type' ? undefined : meta;

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
