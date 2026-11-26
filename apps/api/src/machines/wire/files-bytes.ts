import {
  BYTES_NOTIFICATION,
  MEDIA_MAX_BYTES,
} from '@workspace/machine-protocol';
import type {
  FsBytesResult,
  NativeFailureResult,
  ReadBytesResponse,
} from '@workspace/machine-protocol';
import type { Handler } from './index.js';
import type { MachineRequestOptions } from '../machine-session.js';
import { failure, rpc } from './files-common.js';

type ByteResult = ReadBytesResponse['result'];

type ByteState = {
  size: bigint;
  head: Uint8Array;
  pendingChunks: Array<Uint8Array>;
  mediaType: string | undefined;
  sequence: number;
};

function updateMediaHead(
  state: ByteState,
  chunk: Uint8Array,
): NativeFailureResult | undefined {
  if (state.mediaType !== undefined) return undefined;

  state.pendingChunks.push(chunk);
  const sample = new Uint8Array(Math.min(12, state.head.length + chunk.length));
  sample.set(state.head);
  sample.set(
    chunk.subarray(0, sample.length - state.head.length),
    state.head.length,
  );
  state.head = sample;

  if (
    state.mediaType === undefined &&
    state.head.length < 12 &&
    sniffMediaType(state.head) === 'application/octet-stream'
  )
    return undefined;

  state.mediaType = sniffMediaType(state.head);


  if (state.mediaType === 'application/octet-stream') {
    return {
      status: 'error',
      type: 'unsupported_media_type',
      message: 'The file is not a supported image or PDF.',
    };
  }

  if (state.size > BigInt(MEDIA_MAX_BYTES)) {
    return {
      status: 'error',
      type: 'media_too_large',
      message: 'The file exceeds the media byte bound.',
    };
  }

  return undefined;
}

function updateByteState(
  result: ByteResult,
  state: ByteState,
  options?: MachineRequestOptions,
): NativeFailureResult | undefined {
  if (result.case === 'failure') {
    return (
      failure(result.value) ?? {
        status: 'error',
        type: 'executor_unavailable',
        message: 'File bytes could not be read.',
      }
    );
  }

  if (result.case === 'size') {
    state.size = result.value;

    return undefined;
  }

  if (result.case !== 'chunk') return undefined;

  const chunk = result.value;
  const previouslyDetected = state.mediaType !== undefined;
  const refusal = updateMediaHead(state, chunk);

  if (refusal) return refusal;
  if (state.mediaType === undefined) return undefined;

  const chunks = previouslyDetected ? [chunk] : state.pendingChunks.splice(0);

  for (const pending of chunks) {
    options?.onNotification?.({
      method: BYTES_NOTIFICATION,
      params: {
        seq: state.sequence,
        data: Buffer.from(pending).toString('base64'),
      },
    });
    state.sequence += 1;
  }

  return undefined;
}

export const bytesHandler: Handler<'fs.bytes'> = async (
  session,
  params,
  options,
) => {
  const stream = await rpc(
    session,
    (files, callOptions) =>
      files.readBytes(
        { path: params.path, offset: 0n, limit: BigInt(MEDIA_MAX_BYTES) },
        callOptions,
      ),
    options,
  );

  const state: ByteState = {
    size: 0n,
    head: new Uint8Array(),
    pendingChunks: [],
    mediaType: undefined,
    sequence: 0,
  };

  for await (const frame of stream) {
    const error = updateByteState(frame.result, state, options);

    if (error) return error;
  }

  return {
    size: Number(state.size),
    mediaType: state.mediaType ?? 'application/octet-stream',
  } satisfies FsBytesResult;
};

function sniffMediaType(bytes: Uint8Array): string {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return 'image/png';

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  const sixByteHeader = String.fromCharCode(...bytes.subarray(0, 6));

  if (sixByteHeader === 'GIF87a' || sixByteHeader === 'GIF89a') {
    return 'image/gif';
  }

  if (
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  )
    return 'image/webp';

  if (String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-') {
    return 'application/pdf';
  }

  return 'application/octet-stream';
}
