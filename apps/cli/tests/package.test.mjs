import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { packageStandalone } from '../scripts/package-tree.mjs';
import { directory } from './helpers.mjs';

function pkg(path, name, fields = {}, code = 'module.exports = 42;') {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js', ...fields }));
  writeFileSync(join(path, 'index.js'), code); writeFileSync(join(path, 'LICENSE'), `${name} license`);
}
function source() {
  const dir = directory(); const cli = join(dir, 'cli');
  pkg(cli, 'cli', { main: 'dist/index.js', dependencies: { transport: '1.0.0' }, devDependencies: { never: '1.0.0' } });
  mkdirSync(join(cli, 'dist')); writeFileSync(join(cli, 'dist/index.js'), "module.exports = require('transport');");
  return { dir, cli, output: join(dir, 'portable') };
}
test('standalone package includes production dependencies, transitive peers and licenses but not dev packages', () => {
  const { cli, output } = source();
  pkg(join(cli, 'node_modules/transport'), 'transport', { dependencies: { parser: '1.0.0' }, peerDependencies: { schema: '^1', optional: '^1' }, peerDependenciesMeta: { optional: { optional: true } } }, "module.exports = [require('parser'), require('schema')];");
  pkg(join(cli, 'node_modules/parser'), 'parser', {}, 'module.exports = "parser";');
  pkg(join(cli, 'node_modules/schema'), 'schema', {}, 'module.exports = "schema";');
  packageStandalone(cli, output);
  assert.deepEqual(createRequire(join(output, 'package.json'))('./dist/index.js'), ['parser', 'schema']);
  assert.equal(readFileSync(join(output, 'node_modules/transport/LICENSE'), 'utf8'), 'transport license');
  assert.equal(existsSync(join(output, 'node_modules/never')), false);
});
test('standalone package preserves conflicting nested versions', () => {
  const { cli, output } = source();
  pkg(join(cli, 'node_modules/transport'), 'transport', { dependencies: { parser: '1', inner: '1' } }, "module.exports = [require('parser'), require('inner')];");
  pkg(join(cli, 'node_modules/parser'), 'parser', {}, 'module.exports = "v1";');
  pkg(join(cli, 'node_modules/inner'), 'inner', { dependencies: { parser: '2' } }, "module.exports = require('parser');");
  pkg(join(cli, 'node_modules/inner/node_modules/parser'), 'parser', { version: '2.0.0' }, 'module.exports = "v2";');
  packageStandalone(cli, output);
  assert.deepEqual(createRequire(join(output, 'package.json'))('./dist/index.js'), ['v1', 'v2']);
});
test('missing production dependency fails packaging and preserves an existing distribution', () => {
  const { cli, output } = source(); mkdirSync(output); writeFileSync(join(output, 'previous'), 'working');
  assert.throws(() => packageStandalone(cli, output), /Missing installed production dependency transport/);
  assert.equal(readFileSync(join(output, 'previous'), 'utf8'), 'working');
});
