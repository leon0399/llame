import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { z } from 'zod';

// Pin an OpenCode revision so review and regeneration use identical source data.
const revision = process.argv[2];

if (!/^[a-f0-9]{40}$/u.test(revision ?? '')) {
  throw new Error(
    'Usage: node apps/api/scripts/update-provider-model-wires.mts <opencode-commit>',
  );
}

const source = `https://raw.githubusercontent.com/anomalyco/opencode/${revision}/packages/core/src/models-dev/snapshot.txt`;
const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });

if (!response.ok)
  throw new Error(`Catalog download failed: ${response.status}`);

const text = await response.text();

const providerSchema = z.object({
  models: z.record(
    z.string(),
    z.object({
      id: z.string(),
      type: z.string(),
      api: z.record(z.string(), z.unknown()),
    }),
  ),
});

const catalog = z
  .object({
    'opencode-go': providerSchema,
    opencode: providerSchema,
  })
  .parse(JSON.parse(text));

const providers: Record<string, Record<string, string>> = {};

for (const [local, upstream] of [
  ['opencode-go', 'opencode-go'],
  ['opencode-zen', 'opencode'],
] as const) {
  const { models } = catalog[upstream];

  providers[local] = Object.fromEntries(
    Object.entries(models)
      .filter(([, model]) => model.type === 'chat')
      .map(([id, model]) => {
        const protocol = Object.keys(model.api)[0];

        if (model.id !== id || !protocol)
          throw new Error(`Invalid model metadata: ${upstream}/${id}`);

        return [id, protocol] as const;
      })
      .sort(([a], [b]) => a.localeCompare(b, 'en')),
  );
}

writeFileSync(
  new URL('../src/instance-config/provider-model-wires.json', import.meta.url),
  JSON.stringify(
    {
      source,
      sha256: createHash('sha256').update(text).digest('hex'),
      providers,
    },
    null,
    2,
  ) + '\n',
);
