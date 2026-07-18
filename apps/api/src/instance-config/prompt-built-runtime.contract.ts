import path from 'node:path';

import { createModelPromptLoader } from './prompt-loader';

/**
 * Build contract executed by package.json after `nest build`. Importing this
 * compiled module makes `prompt-loader` resolve from `dist/instance-config`,
 * so success proves Nest copied the default prompt to the matching dist path
 * and that the built runtime can read, normalize, and render it.
 */
const prompt = createModelPromptLoader({
  configPath: path.resolve(process.cwd(), 'llame.config.json'),
}).resolve({
  id: 'built-runtime-contract',
  name: 'Built runtime contract',
});

if (
  prompt.systemPromptSource !== 'project_default' ||
  prompt.systemPrompt.trim().length === 0
) {
  throw new Error(
    'Built runtime failed to load and render the packaged default system prompt',
  );
}
