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
`development/` and `research/` are not.

## Authoring rules

- **One rule, one page.** State a behavior on the page that owns it and link
  to it from everywhere else. Reference pages own behavior; operator pages own
  configuration and procedure.
- **Reference pages carry nothing an operator does.** No configuration
  procedures, no config keys beyond a tool id, a locator form, or a permission
  group name, no `apps/api` or `dist/` paths, no table names, no pnpm commands,
  no issue or PR numbers. Say "the operator enables this" and link the
  operator page.
- **Every `product/` page opens with frontmatter.** `summary` is the one line a
  listing prints; `read_when` lists the reasons to open the page. Reference
  pages add `spec` (the owning OpenSpec capability) and `configured_by`;
  operator pages add `behavior`, linking the reference pages they configure.
  `pnpm lint:markdown` enforces `summary`, `read_when`, and `spec`, and
  resolves `spec`, `configured_by`, and `behavior`.
- **Fixed section order.** Pages under `product/reference/tools/` use Purpose,
  Arguments, Locators, Result, Behavior, Bounds, Errors, Configured by, omitting
  an empty section. Pages under `product/reference/locators/` use Form,
  Accepted by, Authority, Behavior, Bounds, Listing, Errors, Configured by,
  likewise. Every packaged tool id has a page under `product/reference/tools/`,
  enforced by a test.
- **Plans are issues, not pages.** A design record that outlives its change
  belongs in `development/`; a plan in progress belongs in its GitHub issue.
- **Links are relative and checked.** `pnpm lint:markdown` fails on a relative
  link whose file or heading anchor does not exist.
