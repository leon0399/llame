import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(cli, '../..');
const output = join(cli, 'standalone');
const shared = ['config-interpolation', 'runtime-safety'];
for (const path of [cli, ...shared.map((name) => join(root, 'packages', name))]) {
  if (!existsSync(join(path, 'dist'))) throw new Error('Build cli and its workspace dependencies before packaging.');
}
rmSync(output, { recursive: true, force: true });
mkdirSync(output);
for (const name of ['bin', 'dist']) cpSync(join(cli, name), join(output, name), { recursive: true });
for (const name of shared) {
  const source = join(root, 'packages', name);
  const target = join(output, 'node_modules', '@workspace', name);
  mkdirSync(target, { recursive: true });
  cpSync(join(source, 'dist'), join(target, 'dist'), { recursive: true });
  const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  writeFileSync(join(target, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, exports: pkg.exports }, null, 2) + '\n');
}
writeFileSync(join(output, 'package.json'), JSON.stringify({ name: 'llame-cli-standalone', version: '0.0.1', private: true, bin: { llame: 'bin/llame.cjs' }, engines: { node: '>=22.19' } }, null, 2) + '\n');
cpSync(join(cli, 'README.md'), join(output, 'README.md'));
console.log(output);
