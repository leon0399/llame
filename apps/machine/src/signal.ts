/**
 * A promise resolved from elsewhere by name: the shape the daemon needs from
 * `Promise.withResolvers`, which this app's TypeScript lib predates.
 */
export type Signal<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

export function createSignal<T>(): Signal<T> {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      settle?.(value);
    },
  };
}
