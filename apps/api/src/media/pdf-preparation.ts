/**
 * PDF preparation (pdf-media D1), shared by ingest and unstored reads: the
 * byte bound, the `/Encrypt` scan, then a page count and permission check
 * parsed by `pdf-parse-entry` in a short-lived, bounded child process.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { Logger } from '@nestjs/common';
import { z } from 'zod';

import {
  MEDIA_MAX_BYTES,
  MEDIA_REFUSAL,
  MediaIngestError,
} from './media-ingest';
import { processEnvironment } from '../tools/env';

export const PDF_MEDIA_TYPE = 'application/pdf';
export const PDF_MAX_PAGES = 100;

const PARSE_TIMEOUT_MS = 10_000;
const MAX_LIVE_PARSES = 2;
/** A child that did not start, or whose bounds could not apply; the entry never uses it. */
const START_FAILURE_STATUS = 70;
const PDF_SIGNATURE = Buffer.from('%PDF-', 'latin1');
const ENCRYPT_TOKEN = Buffer.from('/Encrypt', 'latin1');

/**
 * Linux start chain, `sh -c BOUNDED_START sh node <entry args>`: a 2 GiB
 * address-space limit clamped to the inherited hard limit (refused below
 * V8's start-up floor), then `oom_score_adj` 1000, then `exec node`. Any
 * failed step exits 70 before node starts.
 */
export const BOUNDED_START =
  'h=$(ulimit -H -v); [ "$h" = unlimited ] || [ "$h" -gt 2097152 ] && h=2097152; { [ "$h" -ge 1310720 ] && ulimit -v "$h" && echo 1000 > /proc/self/oom_score_adj; } || exit 70; exec "$@"';

const logger = new Logger('PdfPreparation');

const parseReportSchema = z.strictObject({
  pages: z.number().int(),
  encrypted: z.boolean(),
});
type ParseReport = z.infer<typeof parseReportSchema>;

/** How a parse child is started and how long it may run. */
export type PdfParseChild = {
  command: string;
  args: ReadonlyArray<string>;
  timeoutMs: number;
};

type ChildOutcome = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export function isPdfSignature(head: Uint8Array): boolean {
  return PDF_SIGNATURE.equals(head.subarray(0, PDF_SIGNATURE.length));
}

/**
 * The TypeScript loader cannot start under the address-space limit, so only
 * Vitest may use the unbounded source entry. Every runtime caller requires
 * the compiled entry; the bounds are proved with injected JavaScript entries.
 * Without trap handlers V8 stops reserving about 10 GiB of address space per
 * WebAssembly memory, which the 2 GiB limit refuses; pdf.js instantiates
 * WebAssembly for some inputs.
 */
function defaultParseChild(): PdfParseChild {
  const compiled = path.join(__dirname, 'pdf-parse-entry.js');
  if (existsSync(compiled)) {
    return pdfParseChild(['--disable-wasm-trap-handler', compiled]);
  }
  if (processEnvironment().VITEST !== 'true') {
    logger.error('PDF parse child failed to start: compiled entry is missing');
    throw new MediaIngestError(MEDIA_REFUSAL.pdfUnavailable);
  }
  const entry = path.join(__dirname, 'pdf-parse-entry.ts');
  const args = ['--import', 'tsx', entry];
  return { command: process.execPath, args, timeoutMs: PARSE_TIMEOUT_MS };
}

/** The parse child for `node <entryArgs>`, under the bounded start on Linux. */
export function pdfParseChild(
  entryArgs: ReadonlyArray<string>,
  timeoutMs = PARSE_TIMEOUT_MS,
): PdfParseChild {
  if (process.platform !== 'linux') {
    return { command: process.execPath, args: entryArgs, timeoutMs };
  }
  const args = ['-c', BOUNDED_START, 'sh', process.execPath, ...entryArgs];
  return { command: 'sh', args, timeoutMs };
}

/**
 * Refuses a PDF or returns its page count without modifying the input.
 * Cancellation removes queued work or kills a running child; its slot is
 * released only after that child closes. Tests inject the parse child.
 */
export async function preparePdf(
  input: Buffer,
  child: PdfParseChild = defaultParseChild(),
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  if (input.length > MEDIA_MAX_BYTES) {
    throw new MediaIngestError(MEDIA_REFUSAL.pdfTooLarge);
  }
  if (input.includes(ENCRYPT_TOKEN)) {
    throw new MediaIngestError(MEDIA_REFUSAL.unopenablePdf);
  }
  const report = classify(
    await withParseSlot(() => runChild(input, child, signal), signal),
  );
  if (report.encrypted || report.pages < 1) {
    throw new MediaIngestError(MEDIA_REFUSAL.unopenablePdf);
  }
  if (report.pages > PDF_MAX_PAGES) {
    throw new MediaIngestError(MEDIA_REFUSAL.pdfTooLarge);
  }
  return report.pages;
}

function classify(outcome: ChildOutcome): ParseReport {
  if (outcome.status === START_FAILURE_STATUS && outcome.stdout === '') {
    logger.error(`PDF parse child failed to start: ${outcome.stderr.trim()}`);
    throw new MediaIngestError(MEDIA_REFUSAL.pdfUnavailable);
  }
  if (outcome.status !== 0) {
    throw new MediaIngestError(MEDIA_REFUSAL.unopenablePdf);
  }
  try {
    return parseReportSchema.parse(JSON.parse(outcome.stdout));
  } catch {
    throw new MediaIngestError(MEDIA_REFUSAL.unopenablePdf);
  }
}

let liveParses = 0;
/** The handoff of each parse waiting for a slot, oldest first. */
const waitingParses: Array<() => void> = [];

/**
 * At most two parse children per process; later parses wait for a slot. A
 * cancelled wait leaves the queue instead of being handed a slot, and a
 * cancellation after the handoff releases that slot through the `finally`.
 */
async function withParseSlot<T>(
  task: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  await acquireParseSlot(signal);
  try {
    signal?.throwIfAborted();
    return await task();
  } finally {
    releaseParseSlot();
  }
}

/**
 * Resolves once this parse holds a slot, registering the wait synchronously.
 * Rejects with the signal's reason when a cancelled parse is still queued, so
 * the queue holds no work the caller no longer wants.
 */
function acquireParseSlot(signal?: AbortSignal): Promise<void> {
  if (liveParses < MAX_LIVE_PARSES) {
    liveParses += 1;
    return Promise.resolve();
  }
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const receiveSlot = () => {
    signal?.removeEventListener('abort', cancel);
    resolve();
  };
  const cancel = () => {
    const queuedAt = waitingParses.indexOf(receiveSlot);
    if (queuedAt !== -1) waitingParses.splice(queuedAt, 1);
    reject(signal?.reason);
  };
  waitingParses.push(receiveSlot);
  signal?.addEventListener('abort', cancel, { once: true });
  return promise;
}

/** Hands the slot to the next queued parse, or frees it. */
function releaseParseSlot(): void {
  const next = waitingParses.shift();
  if (next) next();
  else liveParses -= 1;
}

/** Runs one child to close, preserving the slot until killed work is reaped. */
function runChild(
  input: Buffer,
  child: PdfParseChild,
  signal?: AbortSignal,
): Promise<ChildOutcome> {
  const { promise, resolve, reject } = Promise.withResolvers<ChildOutcome>();
  const proc = spawn(child.command, child.args, {
    // `--import tsx` resolves from the working directory in tests.
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout: Array<Buffer> = [];
  const stderr: Array<Buffer> = [];
  const timer = setTimeout(() => proc.kill('SIGKILL'), child.timeoutMs);
  const onCancel = () => proc.kill('SIGKILL');
  let startFailed = false;
  proc.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  // A child exiting mid-write produces EPIPE; its exit classifies the failure.
  proc.stdin.on('error', () => undefined);
  proc.on('error', (error) => {
    startFailed = true;
    stderr.push(Buffer.from(error.message));
  });
  proc.on('close', (status) => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCancel);
    if (signal?.aborted === true) reject(signal.reason);
    else
      resolve({
        status: startFailed ? START_FAILURE_STATUS : status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
  });
  signal?.addEventListener('abort', onCancel, { once: true });
  proc.stdin.end(input);
  return promise;
}
