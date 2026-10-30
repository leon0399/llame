// Copies the files `dist/` needs beside the compiled output that `tsc` does
// not emit: the instance-config JSON Schema and every prompt Markdown file,
// each at the same path relative to `src/`. Runtime modules resolve them
// through `__dirname`, so a source checkout and a dist-only deployment share
// one layout. `--watch` keeps the copies current while `tsc --watch` runs.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  watch,
} from 'node:fs';
import path from 'node:path';

const sourceRoot = path.resolve(__dirname, '../src');
const outputRoot = path.resolve(__dirname, '../dist');

const SCHEMA_PATH = path.join('instance-config', 'llame.config.schema.json');

function isAsset(relativePath: string): boolean {
  return (
    relativePath === SCHEMA_PATH ||
    (relativePath.endsWith('.md') &&
      relativePath.split(path.sep).includes('prompts'))
  );
}

function copyAsset(relativePath: string): void {
  const target = path.join(outputRoot, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(sourceRoot, relativePath), target);
}

for (const entry of readdirSync(sourceRoot, {
  recursive: true,
  withFileTypes: true,
})) {
  const relativePath = path.relative(
    sourceRoot,
    path.join(entry.parentPath, entry.name),
  );
  if (entry.isFile() && isAsset(relativePath)) {
    copyAsset(relativePath);
  }
}

if (process.argv.includes('--watch')) {
  watch(
    sourceRoot,
    { encoding: 'utf8', recursive: true },
    (_event, filename) => {
      if (filename === null || !isAsset(filename)) {
        return;
      }
      if (!existsSync(path.join(sourceRoot, filename))) {
        rmSync(path.join(outputRoot, filename), { force: true });
        return;
      }
      copyAsset(filename);
    },
  );
}
