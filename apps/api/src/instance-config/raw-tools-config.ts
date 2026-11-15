import { type RawWebAdapterEntry } from './llame-config';
import { type RawToolRerankConfig } from './tool-rerank-config';

/** Schema-validated composite fields consumed from the raw tools block. */
export type RawToolsConfig = {
  webAdapters?: Array<RawWebAdapterEntry>;
  artifacts?: { readonly maxBytes?: unknown } | null;
  bash?: {
    readonly maxProcesses?: unknown;
    readonly backgroundAfterSeconds?: unknown;
  } | null;
  jobs?: {
    readonly maxSeconds?: unknown;
    readonly allowUnlimited?: unknown;
  } | null;
  /** An absent or null object bounds nothing; the resolver narrows each leaf. */
  grep?: {
    readonly maxFilesExamined?: unknown;
    readonly maxEntriesListed?: unknown;
    readonly maxBytesRead?: unknown;
    readonly maxFileBytes?: unknown;
    readonly rerank?: RawToolRerankConfig;
  } | null;
};
