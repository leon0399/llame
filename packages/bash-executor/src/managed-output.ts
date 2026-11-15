import type { BashKnownResult, ManagedOutput } from "./types";

/** The output of a command that never started. */
export const NO_OUTPUT: ManagedOutput = {
  stdout: "",
  stderr: "",
  truncated: false,
  truncatedStreams: { stdout: false, stderr: false },
};

export function outputOf(
  result: Pick<
    BashKnownResult,
    "stdout" | "stderr" | "truncated" | "truncatedStreams"
  >,
): ManagedOutput {
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    truncated: result.truncated,
    truncatedStreams: result.truncatedStreams ?? {
      stdout: result.truncated,
      stderr: result.truncated,
    },
  };
}

/** Activity subscriptions let a registry batch captured bytes without polling. */
export function subscribeOutput(
  listeners: Set<(bytes: number) => void>,
  listener: (bytes: number) => void,
): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function captureWithActivity(
  listeners: ReadonlySet<(bytes: number) => void>,
  stream: { readonly text: string },
  append: (chunk: Buffer) => void,
): (chunk: Buffer) => void {
  return (chunk) => {
    const before = stream.text.length;
    append(chunk);

    if (stream.text.length === before || listeners.size === 0) return;
    const bytes = Buffer.byteLength(stream.text.slice(before));

    for (const listener of listeners) listener(bytes);
  };
}

/** A promise and its resolver, for a settlement that another event completes. */
export function deferred<T>() {
  let resolve!: (value: T) => void;

  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}
