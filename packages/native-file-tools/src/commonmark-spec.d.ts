// commonmark-spec ships CommonJS without type declarations; the conformance
// suite reads only these fields.
declare module "commonmark-spec" {
  export const tests: ReadonlyArray<{
    markdown: string;
    section: string;
    number: number;
  }>;
}
