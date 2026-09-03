# Code quality gates

Every enforced ceiling is owned by its producing command. Missing reports,
parse failures, and threshold violations fail closed. CRAP warns when Istanbul cannot
map a function unambiguously; ten API functions currently report that visible
`N/A` debt.

| Metric                     |                      Target | Owner                           |
| -------------------------- | --------------------------: | ------------------------------- |
| Cyclomatic complexity      |                       `<25` | Oxlint modified variant         |
| Cognitive complexity       |                      `<=25` | SonarJS through Oxlint          |
| Halstead difficulty        |                       `<90` | `scripts/quality-metrics.mjs`   |
| Lines per file             |                      `<800` | Oxlint uses stricter 500        |
| Line coverage              |                     `>=85%` | Vitest V8 thresholds            |
| CRAP                       | goal `<=25`; ceiling `<=42` | `@barney-media/crap-typescript` |
| Dead code                  |                         `0` | Knip                            |
| Duplication                |                    `<0.25%` | jscpd                           |
| `any` / unparsed `unknown` |                         `0` | Oxlint and anti-slop            |

Halstead and duplication cover product source and exclude tests, stories,
generated clients, migrations, support, and vendored code. Oxlint also checks
tests, stories, and E2E; only their size limits are relaxed. Coverage and CRAP
cover API, web, and config-interpolation, including unimported product files.
Storybook gates UI behavior until browser coverage is available.

| Workspace            |   Lines | Statements |
| -------------------- | ------: | ---------: |
| API                  | `>=90%` |    `>=88%` |
| Web                  | `>=88%` |    `>=86%` |
| Config interpolation | `>=96%` |    `>=93%` |

Coverage commands regenerate Istanbul data and run function-level CRAP over the
same paths. API currently peaks at CRAP 42 with seven functions above 25. Web
and config interpolation are below 25; all three scripts enforce 42 until the
shared ceiling can move down.

```bash
pnpm lint
pnpm lint:code
pnpm lint:markdown
pnpm lint:openapi
pnpm lint:dead-code
pnpm lint:duplicates
pnpm lint:complexity
pnpm test
pnpm test:metrics
pnpm test:coverage
```

Before deleting a Knip finding, search package scripts and path-based entrypoint
usage; import graphs cannot see those. Compiled-extension hints are expected for
CSS/MDX imports and are suppressed only in the consuming workspace.
