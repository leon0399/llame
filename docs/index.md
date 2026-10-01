# llame documentation

The directory is the audience. [SPEC.md](../SPEC.md) and
[OpenSpec](../openspec/specs) own behavior; these pages are its readable
projection, and the spec wins any disagreement.

| Directory                                       | Reader                       | Contents                                                 |
| ----------------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| [product/reference](product/reference/index.md) | chat owner and the assistant | what each tool, locator, and selector does               |
| [product/operator](product/operator/index.md)   | operator                     | configuration, deployment, threat model, troubleshooting |
| [development](development/index.md)             | contributor                  | testing, quality gates, design records                   |
| [research](research/index.md)                   | contributor                  | noncanonical prior art and studies                       |

`product/` is written to be served to the assistant through a `llame://docs/`
locator ([#1063](https://github.com/leon0399/llame/issues/1063));
`development/` and `research/` are not. Authoring rules are in
[AGENTS.md](AGENTS.md).
