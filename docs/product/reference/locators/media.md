---
summary: "The media:// locator: a read-only handle on an image or PDF the Run owner holds"
read_when:
  - you see a media://<id> locator in a result or an attachment label
  - you need to know what a media:// read returns or why it failed
  - you want to know what a chat thumbnail or the image lightbox shows
spec: native-file-tools
configured_by:
  - ../../operator/media.md
---

# media://

## Form

`media://<id>`, where `<id>` is a lower-case canonical UUID. The scheme is
case-sensitive in the executor: `MEDIA://<id>` and an upper-case id are
malformed. Bare `media://` is reserved and invalid until a library listing
exists. The locator names an image or PDF the Run owner uploaded; attachment
labels (`Image n (media://<id>):` or `PDF n (media://<id>):`) and `media://`
read results carry it. Media read from any other source has no `media://` locator.

## Read

`read({ path: "media://<id>" })` returns the stored object's image result: `kind:
"image"`, `media` and `path` both equal to the locator, and the stored
original's `mediaType`, `width`, and `height`, with no `thumbnail`. It stores
nothing, changes nothing, and triggers no instruction chain. It is the only
image read kept across turns: a later turn replays the image from the store
under the epoch image window, where an image read from a path is not retained;
see [read](../tools/read.md#image-result).

A stored PDF instead returns `kind: "pdf"`, `mediaType: "application/pdf"`,
`pages`, and `byteSize`, with `media` and `path` both equal to its locator.
It has no thumbnail, content, or embedded PDF data. A PDF-capable model
receives its original under the shared media window; another model gets an
omitted placeholder. Like a stored image, it replays from the store across
turns. See [PDF reads](../tools/read.md#pdf-result).

## Authority

The id resolves under tenant enforcement against the Run owner only. A
`media://` read needs no native executor and no Knowledge root: a process that
allowlists `read` serves it, gated by the `read` permission group, which matches
the locator without its selector. A domain-restricted `read` group admits it
only with a `^media://` allow; see
[tool-call permissions](../../operator/tool-call-permissions.md). The locator is
never projected from an entered Workspace root.

## Behavior

An owner gets a `media://` locator by attaching an image in the chat composer:
paste it, pick it with the attach button, or drag and drop it onto the
composer. A paste that also carries text stays an ordinary text paste and
attaches nothing. Only PNG, JPEG, GIF, and WebP files attach; other files are ignored.
A message carries at most 10 images: an eleventh is neither added nor uploaded.

Each image uploads as soon as it is attached and shows as a removable
thumbnail, marked while it uploads. A failed upload stays attached, marked as
failed, with a retry that uploads the same file again. Send stays disabled while
any upload is in flight or failed. A message may carry images and no text.

When the selected model has no image input, the attach button is disabled and a
pasted or dropped image is refused with a `<model> has no image input` toast.
Images already attached stay, the composer shows the same reason inline, and
send stays disabled until they are removed or a model with image input is
selected.

A sent message shows its images as read-only thumbnails above its text, in
attach order, each loading the image's `/model` variant. Upload bounds, the
store, and its routes are described in [Media](../../operator/media.md).

The web chat shows each stored image as a thumbnail of its
[model variant](../../operator/media.md#model-variant): an image attached to
your message above its bubble, a `media://` `read` result in its tool card,
and a `media://` [prompt import](../prompt-imports.md). A fork of your chat
references the same images, so its thumbnails show them too.

An image `read` or imported from any other locator is not stored. Its tool
card or import chip shows the small inline thumbnail saved with the result
instead, without loading any media route. When that thumbnail would have
exceeded its size cap, none was saved, and the card or chip shows a tile
naming the image's dimensions and format that opens nothing.

Activating a thumbnail opens a lightbox over the images of that one place,
starting at the activated one: the attachments of one message, the image of
one `read` result, the images of one prompt-imports chip, or the uploaded
images in the composer. A composer image still uploading or whose upload
failed opens nothing. The arrow keys and the previous and next buttons move
within those images. The image is centered and never enlarged past its
natural size. An image larger than the window in either dimension is fitted
to it; clicking the image or the actual-size button switches between that fit
and 100%, where you scroll to pan. An image that already fits has no
actual-size button, and clicking it does nothing. `Escape` closes the
lightbox and returns focus to the thumbnail.

- A stored image shows its original from `/api/v1/media/<id>/original`. Its
  caption is the `media://` locator. When the original's dimensions and format
  are already known, they come first, for example
  `1600×900 PNG · media://<id>` for a `media://` `read` result or a composer
  upload.
- An unstored image shows its inline thumbnail. Its caption names the
  original's dimensions and format and the locator as it was submitted: the
  path the model passed to `read` or the target you wrote after `@`, for
  example `1600×900 PNG · docs/shot.png`.

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
