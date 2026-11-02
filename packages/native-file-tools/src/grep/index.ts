export { GREP_LIMITS } from "./limits";
export { fileStream, openFileStream } from "./file-stream";
export { compileGrepPatterns } from "./patterns";
export { ignoreAbovePath, ignoreAncestorDirectories } from "./ignore-files";
export type {
  CompiledGrepPatterns,
  GrepPatternCompileResult,
  GrepPatternOptions,
} from "./patterns";
export {
  compileGlob,
  decodeGrepLiteralSpelling,
  normalizeHostScope,
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
  hashGrepInputs,
} from "./cursor";
export type {
  DecodedGrepCursor,
  GrepCursorDecodeResult,
  GrepCursorInput,
  GrepCursorPoint,
  GrepHashInputs,
  GrepPassageCursor,
  GrepPositionCursor,
} from "./cursor";
export { runGrepScan } from "./scan";
export { compareRel } from "./walk";
export {
  grepFileLocator,
  grepIgnoredUnits,
  grepPassageUnits,
  grepWarningsUnits,
  measureGrepRendering,
  renderGrepText,
} from "./model-text";
export { GREP_WARNING_KINDS, GrepPortError } from "./types";
export type {
  GrepBudget,
  GrepEntry,
  GrepFileStream,
  GrepIgnoreFile,
  GrepPageEnd,
  GrepPassage,
  GrepReadRefusal,
  GrepScanInput,
  GrepScanResult,
  GrepScope,
  GrepWarning,
  GrepWarningKind,
  GrepWalkPort,
} from "./types";
