/**
 * Signal-aware primitives shared by every Knowledge filesystem read/search
 * path: abort checks, a cancellable promise wrapper, cancellable resource
 * acquisition/close, and the one `errno` sniff every caller needs.
 */

import { isRecord, isString } from '@workspace/runtime-safety';

import { KnowledgeFilesystemError } from './knowledge-filesystem-errors';

/** Throw if `signal` is already aborted — the entry check before any
 * cancellable filesystem step. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new KnowledgeFilesystemError('knowledge_cancelled');
  }
}

export async function observe<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal?.aborted) {
    void promise.catch(() => undefined);
    throw new KnowledgeFilesystemError('knowledge_cancelled');
  }
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(new KnowledgeFilesystemError('knowledge_cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export async function observeResource<T extends { close(): Promise<void> }>(
  factory: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  throwIfAborted(signal);
  const promise = factory();
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      reject(new KnowledgeFilesystemError('knowledge_cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (resource) => {
        signal.removeEventListener('abort', onAbort);
        if (aborted) {
          void resource.close().catch(() => undefined);
          return;
        }
        resolve(resource);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export async function closeResource(
  resource: { close(): Promise<void> },
  signal: AbortSignal | undefined,
): Promise<void> {
  let failed = false;
  let failure: unknown;
  try {
    await resource.close();
  } catch (error) {
    failed = true;
    failure = error;
  }
  if (signal?.aborted) {
    throw new KnowledgeFilesystemError('knowledge_cancelled');
  }
  if (failed) throw failure;
}

export function isErrno(error: unknown, code: string): boolean {
  return isRecord(error) && isString(error['code']) && error['code'] === code;
}
