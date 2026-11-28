import type { z } from "zod";

/**
 * A JSON value in `localStorage`, read through `useSyncExternalStore`: the
 * server and the hydration render see `fallback`, the browser then reads the
 * stored value, and other tabs' writes arrive through the `storage` event.
 * A value that fails `schema`, or storage that throws (private mode, blocked
 * site data), leaves the fallback in place: nothing here is worth failing a
 * page for.
 */
export type LocalStore<T> = {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  set: (next: T) => void;
};

function readStored<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);

    if (raw === null) return fallback;

    const parsed = schema.safeParse(JSON.parse(raw));

    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

function writeStored<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Kept for this tab only; see `LocalStore`.
  }
}

export function createLocalStore<T>(
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
): LocalStore<T> {
  let cache: T | undefined;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  const onStorage = (event: StorageEvent) => {
    if (event.key !== key) return;

    cache = undefined;
    notify();
  };

  // Attached once and kept: the stores are module singletons, and the cache
  // must hear other tabs even while nothing subscribes (usage is recorded
  // without a subscriber).
  let listening = false;

  const listen = () => {
    if (listening) return;

    listening = true;
    window.addEventListener("storage", onStorage);
  };

  return {
    subscribe(onChange) {
      listen();
      listeners.add(onChange);

      return () => {
        listeners.delete(onChange);
      };
    },
    getSnapshot: () => {
      listen();

      return (cache ??= readStored(key, schema, fallback));
    },
    getServerSnapshot: () => fallback,
    set(next) {
      cache = next;
      writeStored(key, next);
      notify();
    },
  };
}
