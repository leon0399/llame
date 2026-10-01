---
summary: "Which authority each path scheme reaches, which tools accept it, and whether it can be changed"
read_when:
  - you have a path argument and need to know what it addresses
  - you need to know whether a scheme can be written to or triggers instructions
spec: native-file-tools
configured_by:
  - ../../operator/native-files.md
  - ../../operator/knowledge.md
  - ../../operator/skills.md
  - ../../operator/web-read.md
---

# Locators

Native `read`, `edit`, and `write` select their authority from the scheme of
their `path` argument. An absolute path executes on the worker's filesystem with
its OS user's authority. A `kb://<knowledgeSpaceId>/<path>[:selector]` locator
resolves through the trusted Run owner's current Knowledge Space access instead
and never binds the Run to an executor. This alpha capability supplies no
per-user or per-path filesystem permissions or sandbox on either path; `kb://`
narrows exposure to one owner-scoped directory tree.

## Form

Every native `path` is `<locator>[:<selector>]` where the selector is optional
and read-only. Each scheme page states its accepted spellings; see
[selectors](../selectors.md) for the selector grammar.

## Accepted by

| Scheme        | `read` | `edit` | `write` | Executor | Authority                               | Mutable | Triggers instructions |
| ------------- | ------ | ------ | ------- | -------- | --------------------------------------- | ------- | --------------------- |
| absolute path | yes    | yes    | yes     | yes      | the worker's filesystem, its OS user    | yes     | yes                   |
| `file://`     | yes    | yes    | yes     | yes      | the worker's filesystem, its OS user    | yes     | yes                   |
| `kb://`       | yes    | yes    | yes     | no       | the owner's Knowledge Space directory   | yes     | yes, inside the Space |
| `skill://`    | yes    | no     | no      | no       | an installed skill package, read-only   | no      | no                    |
| `http(s)://`  | yes    | no     | no      | no       | the public web, through the API process | no      | no                    |

`edit` and `write` reject `http://` and `https://` with `invalid_path` before
any request, and reject `skill://` with `unsupported_operation` and no
filesystem effect. The operator enables the host executor the first two rows
need; see [native files](../../operator/native-files.md#enabling).

## Authority

A `kb://` identifier resolves under the trusted Run owner's current Space
access on every call, with no filesystem probe; `skill://` resolves inside a
package the operator installed; `http(s)://` is fetched by the API process.
None of the three binds the Run to an executor.

An unimplemented `scheme://` prefix — for example `vault://x` — fails closed
with `invalid_path` on `read`, `edit`, and `write` alike. It is never treated as
a literal relative or absolute filename, and no file named after the scheme is
read, created, or modified.

## Listing

Each scheme's directory or catalog listing is documented on its own page: an
absolute path and `file://` in [host-path](host-path.md), a Space directory in
[kb](kb.md), a package directory and the catalog in [skill](skill.md), and a web
adapter directory in [web](web.md).

## Errors

`invalid_path` covers a refused locator form, an unimplemented scheme, a `kb://`
identifier with no Space, and a trailing representation member the scheme splits
differently — `kb://` and `skill://` refuse `:outline:raw` and `:raw:outline`
that a host path or web read accepts; see
[selectors](../selectors.md#markdown-outline). `not_found` covers a refused
symbolic-link component on `kb://` and an absent path. The shared native
vocabulary is in [read](../tools/read.md#errors).

## Configured by

- [Native files](../../operator/native-files.md) enables the host executor the
  absolute-path and `file://` rows need.
- [Personal Knowledge](../../operator/knowledge.md) configures the Knowledge root
  behind `kb://`.
- [Skills](../../operator/skills.md) installs the packages `skill://` reads.
- [Web reads](../../operator/web-read.md) configures `http(s)://` adapters and
  restrictions.
