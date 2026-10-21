/** Code-owned grep bounds (design D9); none of them is an operator knob. */
export const GREP_LIMITS = {
  maxPatterns: 8,
  maxPatternBytes: 512,
  maxScopes: 16,
  filesPerPage: 20,
  passagesPerFile: 20,
  lineCodeUnits: 512,
  contextLines: 1,
  passageLines: 2000,
  filesExamined: 5000,
  entriesListed: 20_000,
  bytesRead: 32 * 1024 * 1024,
  fileBytes: 1024 * 1024,
  nulProbeBytes: 8 * 1024,
  deadlineMs: 30_000,
  pageCodeUnits: 15_000,
} as const;
