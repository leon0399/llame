/**
 * PDF parse child (pdf-media D1): reads one PDF from stdin and writes
 * `{"pages":n,"encrypted":bool}` to stdout. A parse failure exits 1 with no
 * output. It runs as its own process because pdf.js parses on the calling
 * thread with unbounded off-heap memory; `pdf-preparation.ts` spawns it.
 */

import { buffer } from 'node:stream/consumers';
import { getDocumentProxy } from 'unpdf';

/** pdf.js `VerbosityLevel.ERRORS`: its warnings go to stdout and would corrupt the report. */
const PDFJS_ERRORS_ONLY = 0;

async function main(): Promise<void> {
  try {
    const bytes = await buffer(process.stdin);
    // getMetadata() is never called: it inflates the whole XMP stream.
    const document = await getDocumentProxy(new Uint8Array(bytes), {
      verbosity: PDFJS_ERRORS_ONLY,
    });
    const permissions = await document.getPermissions();
    const report = {
      pages: document.numPages,
      encrypted: permissions !== null,
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch {
    process.exitCode = 1;
  }
}

void main();
