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
 * Refuses a PDF or returns its page count; the caller's buffer is never
 * modified. Tests inject the parse child.
 */
export async function preparePdf(
  input: Buffer,
  child: PdfParseChild = defaultParseChild(),
): Promise<number> {
  if (input.length > MEDIA_MAX_BYTES) {
    throw new MediaIngestError(MEDIA_REFUSAL.pdfTooLarge);
  }
  if (input.includes(ENCRYPT_TOKEN)) {
    throw new MediaIngestError(MEDIA_REFUSAL.unopenablePdf);
  }
  const report = classify(await withParseSlot(() => runChild(input, child)));
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
const waitingParses: Array<() => void> = [];

/** At most two parse children per process; later parses wait for a slot. */
async function withParseSlot<T>(task: () => Promise<T>): Promise<T> {
  if (liveParses < MAX_LIVE_PARSES) liveParses += 1;
  else await new Promise<void>((resolve) => waitingParses.push(resolve));
  try {
    return await task();
  } finally {
    const next = waitingParses.shift();
    if (next) next();
    else liveParses -= 1;
  }
}

/** Runs one child to exit; a timeout ends it with `SIGKILL` (status null). */
function runChild(input: Buffer, child: PdfParseChild): Promise<ChildOutcome> {
  return new Promise((resolve) => {
    const proc = spawn(child.command, child.args, {
      // `--import tsx` (tests) resolves its specifier from the working directory.
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Array<Buffer> = [];
    const stderr: Array<Buffer> = [];
    const timer = setTimeout(() => proc.kill('SIGKILL'), child.timeoutMs);
    const finish = (status: number | null) => {
      clearTimeout(timer);
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    };
    proc.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    // A child that exits mid-write fails the write with EPIPE; its exit status classifies it.
    proc.stdin.on('error', () => undefined);
    // A child that never started classifies like a bound that could not apply.
    proc.on('error', (error) => {
      stderr.push(Buffer.from(error.message));
      finish(START_FAILURE_STATUS);
    });
    proc.on('close', (status) => finish(status));
    proc.stdin.end(input);
  });
}
