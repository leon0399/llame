---
summary: "The media:// locator: a read-only handle on one image the Run owner holds"
read_when:
  - you see a media://<id> locator in a result or an attachment label
  - you need to know what a media:// read returns or why it failed
spec: native-file-tools
configured_by:
  - ../../operator/media.md
---

# media://

## Form

`media://<id>`, where `<id>` is a lower-case canonical UUID. The scheme is
case-sensitive in the executor: `MEDIA://<id>` and an upper-case id are
malformed. Bare `media://` is reserved and invalid until a library listing
exists. The locator names one object in the Run owner's media store; image
results and attachment labels (`Image n (media://<id>):`) carry it.

## Read

`read({ path: "media://<id>" })` returns the stored object's image result: `kind:
"image"`, `media` and `path` both equal to the locator, and the stored
original's `mediaType`, `width`, and `height`. It ingests nothing, changes
nothing, and triggers no instruction chain. The image reaches the model as any
other image result does; see [read](../tools/read.md#image-result).

## Authority

The id resolves under tenant enforcement against the Run owner only. A
`media://` read needs no native executor and no Knowledge root: a process that
allowlists `read` serves it, gated by the `read` permission group, which matches
the locator without its selector. A domain-restricted `read` group admits it
only with a `^media://` allow; see
[tool-call permissions](../../operator/tool-call-permissions.md). The locator is
never projected from an entered Workspace root.

## Errors

| Error                   | When                                                      |
| ----------------------- | --------------------------------------------------------- |
| `invalid_path`          | bare `media://` or a malformed id, before any lookup      |
| `invalid_selector`      | any selector, before any lookup                           |
| `not_found`             | another owner's id or an unknown id, indistinguishably    |
| `unsupported_operation` | `edit` or `write` of a `media://` locator, with no lookup |

## Configured by

[Media](../../operator/media.md) describes the store the locator reads. It has
no configuration keys.
