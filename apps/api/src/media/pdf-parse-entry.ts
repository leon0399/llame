/**
 * PDF parse child (pdf-media D1): reads one PDF from stdin and writes
 * `{"pages":n,"encrypted":bool}` to stdout. A parse failure exits 1 with no
 * output. It runs as its own process because pdf.js parses on the calling
 * thread with unbounded off-heap memory; `pdf-preparation.ts` spawns it.
 */

import { buffer } from 'node:stream/consumers';
import { inspectPdfDocument } from './pdf-document';

async function main(): Promise<void> {
  try {
    const bytes = await buffer(process.stdin);
    const report = await inspectPdfDocument(bytes);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch {
    process.exitCode = 1;
  }
}

void main();
