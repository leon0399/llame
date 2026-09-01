# packages/config-typescript

Configuration-only TypeScript presets; no runtime, output, or scripts.

| File                 | Contract                                   | Consumers          |
| -------------------- | ------------------------------------------ | ------------------ |
| `base.json`          | strict shared defaults                     | root, both presets |
| `nextjs.json`        | bundler resolution, preserved JSX, no emit | web, Storybook     |
| `react-library.json` | React JSX transform                        | `@workspace/ui`    |

API owns separate Nest/tsgo settings and must not inherit these incidentally.
Keep aliases, plugins, types, includes, excludes, and output paths in consumers.
Preserve base `NodeNext` unless every consumer moves together. Do not add scripts
or generated output; consumers own complete-program checks.

After `base.json`, run these sequentially; for a leaf preset, run only its
consumers:

```bash
pnpm --filter web typecheck
pnpm --filter storybook typecheck
pnpm --filter @workspace/ui typecheck
pnpm format:check
pnpm lint:markdown
```
