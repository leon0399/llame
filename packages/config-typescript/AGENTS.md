# packages/config-typescript

Shared TypeScript compiler presets. This package owns configuration only: it
has no runtime code, build output, or package scripts.

## Presets and consumers

| File                 | Contract                                      | Direct consumers   |
| -------------------- | --------------------------------------------- | ------------------ |
| `base.json`          | Strict shared language and module defaults    | Root, both presets |
| `nextjs.json`        | Bundler resolution, JSX preservation, no emit | Web, Storybook     |
| `react-library.json` | React JSX transform on the shared base        | `@workspace/ui`    |

`apps/api` deliberately owns a separate Nest/tsgo configuration with decorator
metadata and build-specific settings; do not make it inherit a shared preset as
an incidental cleanup.

## Change discipline

- Treat a preset edit as a fan-out change. Keep app-specific aliases, plugins,
  `types`, includes, excludes, and output paths in the consuming workspace.
- Preserve `NodeNext` in the base unless every consumer is migrated together.
  Next.js consumers override it with bundler resolution; React libraries only
  add the JSX transform.
- Do not add scripts or generated output to this package. Consumers own
  typechecking because they own the complete program and framework tooling.
- After changing `base.json`, verify web, Storybook, and UI sequentially. For a
  leaf-preset change, verify only its direct consumers. Use:

  ```bash
  pnpm --filter web typecheck
  pnpm --filter storybook typecheck
  pnpm --filter @workspace/ui typecheck
  ```

  Keep these foreground and sequential; do not substitute the aggregate build.

- Format and validate documentation/config changes from the repository root
  with `pnpm format:check` and `pnpm lint:markdown`.
