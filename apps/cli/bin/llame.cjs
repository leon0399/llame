#!/usr/bin/env node
'use strict';
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const entry = join(__dirname, '../dist/main.js');
if (!existsSync(entry)) {
  console.error('Build first: pnpm exec turbo run build --filter=cli --concurrency=1');
  process.exitCode = 1;
} else {
  require(entry);
}
