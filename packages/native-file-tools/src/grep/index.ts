export { GREP_LIMITS } from "./limits";
export { fileStream, openFileStream } from "./file-stream";
export { compileGrepPatterns } from "./patterns";
export {
  collectAncestorIgnoreFiles,
  GREP_IGNORE_FILE_NAMES,
  ignoreAbovePath,
  ignoreAncestorDirectories,
  isAtOrBelow,
  repositoryDirectory,
  type AncestorIgnoreInput,
  type GrepIgnoreFileName,
  type ReadIgnoreFile,
} from "./ignore-files";
export type {
  CompiledGrepPatterns,
  GrepPatternCompileResult,
  GrepPatternOptions,
} from "./patterns";
export {
  compileGlob,
  decodeGrepLiteralSpelling,
  normalizeHostScope,
  spellGrepHostScopeLocator,
  spellGrepMachineScopeLocator,
  splitGrepScope,
} from "./scope";
export type {
  CompiledGlob,
  GrepScopeSplit,
  GrepScopeSplitResult,
} from "./scope";
export {
  decodeGrepCursor,
  encodeGrepCursor,
  grepContinuationUnits,
} from "./cursor";
export type {
  DecodedGrepCursor,
  GrepCursorDecodeResult,
  GrepCursorInput,
  GrepCursorPoint,
  GrepPassageCursor,
  GrepPositionCursor,
} from "./cursor";
export { runGrepScan } from "./scan";
export { passageEndLine, passageStartLine } from "./passages";
export { compareRel } from "./walk";
export {
  grepFileLocator,
  grepIgnoredUnits,
  grepPassageUnits,
  grepUnfinishedUnits,
  grepWarningsUnits,
  measureGrepRendering,
  renderGrepText,
} from "./model-text";
export { GREP_WARNING_KINDS, GrepPortError } from "./types";
export type {
  GrepBudget,
  GrepEntry,
  GrepFileStream,
  GrepIgnored,
  GrepIgnoreFile,
  GrepPassage,
  GrepReadRefusal,
  GrepScanInput,
  GrepScanResult,
  GrepScope,
  GrepWarning,
  GrepWarningKind,
  GrepWalkPort,
} from "./types";
