# llame-node

Independent personal Node application. It composes `@workspace/personal-node`
without importing the CLI or the hosted API. SQLite, provider and MCP configuration,
execution, approvals, recall and live Knowledge belong to the personal runtime.

```bash
pnpm exec turbo run build --filter=@workspace/node --concurrency=1
node apps/node/bin/llame-node.cjs --help
node apps/node/bin/llame-node.cjs
node apps/node/bin/llame-node.cjs recover --data-dir /absolute/data-dir
```

The default is a persistent foreground service on its private Unix socket.
`--stdio` selects newline-delimited private IPC for an embedding Surface.
`--config FILE`, `--data-dir DIR`, and explicit `--native --cwd DIR` select its
boot identity/grant. There is no TCP server, account requirement, or automatic
service installation. After a crash, `recover` removes the recorded endpoint
only after proving that its owner process stopped. Unconfigured inference
requires the owner's provider setup.

See the [integration guide](../../docs/node/integration.md) and
[private version-2 protocol](../../docs/node/local-protocol.md).
