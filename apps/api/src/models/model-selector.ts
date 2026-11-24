/**
 * A model selector names either a model role (`@` plus the role name) or one
 * exact `models[].id`. A model id never starts with `@` (boot rejects one), so
 * the first character decides the kind.
 */

export const ROLE_SIGN = '@';

export const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

export type ModelSelector =
  | { readonly kind: 'role'; readonly roleName: string }
  | { readonly kind: 'model'; readonly modelId: string };

export function parseModelSelector(selector: string): ModelSelector {
  return selector.startsWith(ROLE_SIGN)
    ? { kind: 'role', roleName: selector.slice(ROLE_SIGN.length) }
    : { kind: 'model', modelId: selector };
}
