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

// Verify every packaged tool description resolves from the built output.
// loadPackagedToolDescription uses __dirname to find prompts/tools/*.md,
// so running this from dist/ proves Nest copied the nested assets. The list
// comes from the registry itself, so a tool added there is covered here
// without a second edit.
import {
  loadPackagedToolDescription,
  TOOL_PROMPT_IDS,
} from '../prompts/tool-descriptions';

for (const id of TOOL_PROMPT_IDS) {
  const description = loadPackagedToolDescription(id);
  if (description.trim().length === 0) {
    throw new Error(
      `Built runtime failed to load packaged tool description: ${id}`,
    );
  }
}

// Verify the chats producers' packaged bodies resolve from the built output.
// Every template constant there calls `loadPackagedTemplate` EAGERLY at module
// initialization, so importing the module IS the proof: it reads
// `chats/prompts/*.md` through `__dirname`, and running this from dist/ means a
// missing, empty, or malformed template throws before the import completes.
// Nothing is called here on purpose — a rendered assertion would add branches
// no test can reach, and this file is a build step, not a unit under test. The
// build is plain `tsc` output with no bundler, so a side-effect import stands.
import '../chats/context-item-producers';

// Same proof for the compaction instructions: importing the module renders both
// packaged instructions at initialization from `compaction/prompts/*.md`.
import '../compaction/compaction';

// Same proof for `titles/prompts/*.md`: `titles/title` loads both at import.
import '../titles/title';
