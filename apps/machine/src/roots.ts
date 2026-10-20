import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export class RootsFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RootsFileError";
  }
}

type RootsDocument = { readonly roots: ReadonlyArray<string> };

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRootsDocument(value: unknown): value is RootsDocument {
  if (typeof value !== "object" || value === null || !("roots" in value))
    return false;
  const roots = value.roots;
  return (
    Array.isArray(roots) &&
    roots.every((root) => isString(root) && isAbsolute(root))
  );
}

/**
 * The roots this Machine addresses, each as the canonical path `roots add`
 * recorded. Roots bound addressing only: anything running as the Machine user
 * can edit this file, and the daemon loads it once per session.
 */
export function readRoots(file: string): Array<string> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw new RootsFileError(`The roots file ${file} could not be read.`);
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new RootsFileError(`The roots file ${file} is not valid JSON.`);
  }
  if (!isRootsDocument(document))
    throw new RootsFileError(
      `The roots file ${file} must hold {"roots": ["/absolute/path", ...]}.`,
    );
  return [...document.roots];
}

function writeRoots(file: string, roots: ReadonlyArray<string>): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ roots }, null, 2)}\n`, {
    mode: 0o600,
  });
  try {
    renameSync(temporary, file);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary is already gone; the rename failure is the report.
    }
    throw error;
  }
}

/**
 * The canonical form of a directory the operator named. A root that resolved
 * later to something else would silently widen what the Machine addresses, so
 * registering requires the directory to exist.
 */
function canonicalDirectory(directory: string, required = true): string {
  const literal = resolve(directory);
  try {
    const canonical = realpathSync(literal);
    if (required && !statSync(canonical).isDirectory())
      throw new RootsFileError(`Not a directory: ${directory}`);
    return canonical;
  } catch (error) {
    if (error instanceof RootsFileError) throw error;
    if (!required) return literal;
    throw new RootsFileError(`Directory does not exist: ${directory}`);
  }
}

/** Registers one directory by its canonical path, and returns that path. */
export function addRoot(file: string, directory: string): string {
  const canonical = canonicalDirectory(directory);
  const roots = readRoots(file);
  if (!roots.includes(canonical)) writeRoots(file, [...roots, canonical]);
  return canonical;
}

/** Removes one directory, matched as the canonical path `add` records. */
export function removeRoot(file: string, directory: string): string {
  const canonical = canonicalDirectory(directory, false);
  const roots = readRoots(file);
  const remaining = roots.filter((root) => root !== canonical);
  if (remaining.length === roots.length)
    throw new RootsFileError(`Root is not registered: ${canonical}`);
  writeRoots(file, remaining);
  return canonical;
}
