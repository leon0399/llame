// Type declarations for the two web-read dependencies whose shipped types do
// not resolve from apps/api's CommonJS build.

/**
 * linkedom is published as ESM: the package is `"type": "module"`, so the
 * declaration file its `types` condition resolves to — the same one for
 * `import` and for `require`, since that condition is unconditional — is an
 * ECMAScript module. This build compiles as CommonJS, so tsc refuses the static
 * import with TS1479. Declaring only the surface `pipeline.ts` imports keeps
 * the shipped signature without reaching into `node_modules`, whose layout is
 * an implementation detail of the installer.
 */
declare module 'linkedom' {
  export function parseHTML(html: string): Window & typeof globalThis;
}

/** turndown-plugin-gfm ships no type declarations at all. */
declare module 'turndown-plugin-gfm' {
  export const gfm: import('turndown').Plugin;
}
