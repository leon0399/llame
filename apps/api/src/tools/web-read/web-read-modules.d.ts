// Type declarations for the web dependencies whose shipped types do not
// resolve from apps/api's CommonJS build. `linkedom` serves web-read and the
// web-search engines; `turndown-plugin-gfm` serves web-read alone.

/**
 * linkedom is published as ESM: the package is `"type": "module"`, so the
 * declaration file its `types` condition resolves to — the same one for
 * `import` and for `require`, since that condition is unconditional — is an
 * ECMAScript module. This build compiles as CommonJS, so tsc refuses the static
 * import with TS1479. Declaring only the surface web-read and web-search use
 * keeps the shipped signature without reaching into `node_modules`, whose
 * layout is an implementation detail of the installer.
 */
declare module 'linkedom' {
  export function parseHTML(html: string): Window & typeof globalThis;
  /**
   * The parser `yandex.ts` needs: HTML parsing leaves the contents of a
   * `<title>` element as literal text, so the XML mode is the one that reads
   * Yandex's XML envelope, where `<hlword>` is an element to strip.
   */
  export class DOMParser {
    parseFromString(markup: string, mimeType: 'text/xml'): Document;
  }
}

/** turndown-plugin-gfm ships no type declarations at all. */
declare module 'turndown-plugin-gfm' {
  export const gfm: import('turndown').Plugin;
}
