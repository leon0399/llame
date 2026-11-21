/**
 * A scripted `fs.grep` answer for a hub test that needs the grep tool to see a
 * Machine result without walking a tree (host-as-machine design D8): after L3
 * every host grep is a Machine request, so a harness whose peer serves only the
 * file methods must answer this one too. Compose it with
 * `machineFilesAnswer({ answer })` or a bare `createProtocolPeer({ answer })`.
 *
 * Deliberately under `src/testing/`: scaffolding, excluded from coverage and
 * mutation, never imported by production code.
 */

import { FS_GREP_METHOD } from '@workspace/machine-protocol';

import { type PeerAnswer, type PeerCall } from './machine-protocol-peer';

/** One passage the scripted answer returns, relative to the walked prefix. */
export type ScriptedGrepPassage = {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
  readonly matches: ReadonlyArray<number>;
};

export type GrepAnswerOptions = {
  /** The passages the one page holds; one small match by default. */
  readonly passages?: ReadonlyArray<ScriptedGrepPassage>;
  readonly complete?: boolean;
  /** A resume key, for a test that wants a second page. */
  readonly cursor?: string;
  readonly consumed?: { files: number; entries: number; bytes: number };
};

/** The default page: one matched line of a file named `Run.md`. */
const DEFAULT_PASSAGES: ReadonlyArray<ScriptedGrepPassage> = [
  { path: 'Run.md', startLine: 1, endLine: 1, content: '1: Run', matches: [1] },
];

/**
 * The `fs.grep` answer, and `undefined` for every other method so a caller's
 * own defaults keep serving them.
 */
export function grepAnswer(
  options: GrepAnswerOptions = {},
): (call: PeerCall) => PeerAnswer | undefined {
  const passages = options.passages ?? DEFAULT_PASSAGES;

  return (call) => {
    if (call.method !== FS_GREP_METHOD) return undefined;

    return {
      value: {
        ok: true,
        results: passages.map((passage) => ({ ...passage })),
        complete: options.complete ?? true,
        warnings: [],
        consumed:
          options.consumed ??
          ({
            files: passages.length,
            entries: passages.length,
            bytes: 0,
          } as const),
        progressed: false,
        ...(options.cursor !== undefined && { cursor: options.cursor }),
      },
    };
  };
}
