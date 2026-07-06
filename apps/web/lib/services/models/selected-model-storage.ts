/**
 * Persist the user's last-selected model across sessions (a global model
 * preference, like ChatGPT's picker). Keyed PER USER — llame is multi-user and
 * localStorage is per-browser, so a shared machine must not bleed one user's
 * preference to another. SSR-safe (`window`-guarded) and failure-tolerant
 * (private mode / disabled / full storage all degrade to a no-op or null, never
 * throw). No imports, so vitest loads it standalone.
 */
const keyFor = (userId: string) => `llame:selected-model:${userId}`;

export function readSelectedModel(userId: string): string | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    return window.localStorage.getItem(keyFor(userId));
  } catch {
    return null;
  }
}

export function writeSelectedModel(userId: string, modelId: string): void {
  // Don't persist an empty selection (the selector's deselect toggle) as if it
  // were a model — leave the last real choice in place.
  if (typeof window === "undefined" || !userId || !modelId) return;
  try {
    window.localStorage.setItem(keyFor(userId), modelId);
  } catch {
    // private mode / quota exceeded — a persisted preference is best-effort.
  }
}
