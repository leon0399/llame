---
type: Reference
title: "Fabric"
description: "File-based prompt composition and drift checks"
resource: "https://github.com/danielmiessler/fabric"
observed:
  date: "2026-09-10"
  revision: "b682dad740f24e85ce9a48d23babc6780dd476ac"
sources:
  - id: internal-plugins-db-fsdb-patterns-go
    resource: "https://github.com/danielmiessler/fabric/blob/b682dad740f24e85ce9a48d23babc6780dd476ac/internal/plugins/db/fsdb/patterns.go"
    title: "Pattern loading"
  - id: internal-core-chatter-go-l218-l346
    resource: "https://github.com/danielmiessler/fabric/blob/b682dad740f24e85ce9a48d23babc6780dd476ac/internal/core/chatter.go#L218-L346"
    title: "Request assembly"
  - id: internal-plugins-template-extension-registry-go-l238-l275
    resource: "https://github.com/danielmiessler/fabric/blob/b682dad740f24e85ce9a48d23babc6780dd476ac/internal/plugins/template/extension_registry.go#L238-L275"
    title: "extension registry"
  - id: internal-plugins-template-extension-executor-go-l31-l152
    resource: "https://github.com/danielmiessler/fabric/blob/b682dad740f24e85ce9a48d23babc6780dd476ac/internal/plugins/template/extension_executor.go#L31-L152"
    title: "Extension execution"
---

# Fabric

- **Stack:** Go CLI/server, filesystem-backed patterns, contexts, and sessions; MIT

High-confidence narrow reference for prompt assets; moderate applicability to
future Profiles/Skills. Pattern loading[^internal-plugins-db-fsdb-patterns-go]
supports named files, explicit variables, an input insertion point, and custom
overrides. Request assembly[^internal-core-chatter-go-l218-l346]
composes patterns with reusable context and strategies. This informs llame's
file-native profile direction: resolve composition through trusted code and bind
the effective result to the Run receipt.

Its extension registry[^internal-plugins-template-extension-registry-go-l238-l275]
checks both definition and executable hashes before returning an extension.
Useful drift-detection prior art for future installed executable capabilities;
the hashes do not establish trust or prevent a replacement after the check.

**Caution:** Template expansion can invoke file, network, and executable plugins
during prompt construction. Extension execution[^internal-plugins-template-extension-executor-go-l31-l152]
uses unsandboxed `sh -c` with inherited process environment; only the file-output
path applies its timeout. These mechanisms require llame's explicit tool and
executor authority, not permission inferred from a prompt asset. Local JSON
sessions and a global server API key do not supply llame's durable Runs or
owner isolation. Study assets and integrity checks without importing a second
session store or ambient execution into prompt rendering.

[^internal-plugins-db-fsdb-patterns-go]: [Pattern loading](https://github.com/danielmiessler/fabric/blob/b682dad740f24e85ce9a48d23babc6780dd476ac/internal/plugins/db/fsdb/patterns.go)

[^internal-core-chatter-go-l218-l346]: [Request assembly](https://github.com/danielmiessler/fabric/blob/b682dad740f24e85ce9a48d23babc6780dd476ac/internal/core/chatter.go#L218-L346)

[^internal-plugins-template-extension-registry-go-l238-l275]: [extension registry](https://github.com/danielmiessler/fabric/blob/b682dad740f24e85ce9a48d23babc6780dd476ac/internal/plugins/template/extension_registry.go#L238-L275)

[^internal-plugins-template-extension-executor-go-l31-l152]: [Extension execution](https://github.com/danielmiessler/fabric/blob/b682dad740f24e85ce9a48d23babc6780dd476ac/internal/plugins/template/extension_executor.go#L31-L152)
