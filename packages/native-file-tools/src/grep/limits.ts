/** Code-owned grep bounds; none of them is an operator knob. The walk's file,
 *  entry, byte, and file-size bounds come from `tools.grep` and the call
 *  deadline from the tool call timeout, so they are absent here. */
export const GREP_LIMITS = {
  maxPatterns: 8,
  maxPatternBytes: 512,
  maxScopes: 16,
  filesPerPage: 20,
  passagesPerFile: 20,
  lineCodeUnits: 512,
  contextLines: 1,
  passageLines: 2000,
  /** Longest logical line the walk searches; a longer one drops its file. */
  lineBytes: 4 * 1024 * 1024,
  nulProbeBytes: 8 * 1024,
  pageCodeUnits: 15_000,
  /**
   * Queued read-ahead slots. A slot frees when the consumer takes a candidate,
   * so the head read is one more: at most nine files are open at once.
   */
  readAhead: 8,
} as const;
