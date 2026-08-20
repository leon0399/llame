import path from 'node:path';

import {
  createModelPromptLoader,
  renderSystemPromptTemplate,
} from './prompt-loader';

/**
 * Build contract executed by package.json after `nest build`. Importing this
 * compiled module makes `prompt-loader` resolve from `dist/instance-config`,
 * so success proves Nest copied the default prompt to the matching dist path
 * and that the built runtime can read, normalize, and render it.
 */
const prompt = createModelPromptLoader({
  configPath: path.resolve(process.cwd(), 'llame.config.json'),
});

const model = {
  id: 'built-runtime-contract',
  name: 'Built runtime contract',
};
const resolved = prompt.resolve(model);

const contractAnchor = {
  systemTime: '2000-01-01 00:00+00:00',
  systemTimezone: 'UTC',
};

// Rendered with no per-user context, exactly as the boot probe does — the
// packaged default must stand up for an owner who has personalized nothing.
if (
  resolved.systemPromptSource !== 'project_default' ||
  renderSystemPromptTemplate({
    template: resolved.systemPromptTemplate,
    model,
    anchor: contractAnchor,
  }).trim().length === 0
) {
  throw new Error(
    'Built runtime failed to load and render the packaged default system prompt',
  );
}
