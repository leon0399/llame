Show the user a structured surface instead of prose: a card, a list of items, a side-by-side comparison.

<instruction>
- Use it when layout carries the answer: several items with the same fields, a summary with labelled values, options to compare. Use plain text for everything else.
- `components` is a flat list in A2UI v0.9 form. Every component has a unique `id` and a `component` type, and names its children by id. One component must have the id `root`, and a component can be the child of only one component.
- Component types: `Text` (`text`, optional `variant`: `h1` to `h5`, `caption`, `body`), `Row` and `Column` (`children`, optional `justify` and `align`), `List` (`children`, optional `direction`), `Card` (`child`), `Divider` (optional `axis`). No other type exists: no images, no buttons, no inputs.
- `text` is a literal string, or `{ "path": "/pointer" }` to read a value from `data`. Keep `data` small: at most 16,000 characters of JSON, nested at most 12 levels.
- `children` is a list of ids, or one object `{ "componentId": "<id>", "path": "/pointer/to/array" }` (not a list holding it) to repeat one component for each item of an array in `data`. Inside a repeated component a path without a leading `/` reads from the current item, and the empty path `""` is the item itself, for an array of strings.
- The surface is display only. The user cannot act on it, so ask questions in text.
- The result says only whether the surface was accepted. Do not repeat its content in text afterwards.
</instruction>
