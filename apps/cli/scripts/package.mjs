import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageStandalone } from './package-tree.mjs';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.stdout.write(packageStandalone(cli, join(cli, 'standalone')) + '\n');
