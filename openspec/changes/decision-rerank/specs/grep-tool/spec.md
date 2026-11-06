# Spec Delta

## MODIFIED Requirements

### Requirement: The grep tool accepts one strict input object

The code-owned `grep` tool MUST declare the `read_only` classification. Its
input MUST be one strict object. The tool MUST reject an unknown property as
`invalid_input`.

- `patterns`: an array of 1 to 8 strings. Each string MUST hold 1 to 512
  UTF-8 bytes. The array is a disjunction. A line matches when at least one
  pattern matches it.
- `scopes`: an optional array of 1 to 16 scope strings. The scope grammar is
  defined below.
- `literal`: an optional boolean, default `false`. When `true`, the tool MUST
  match each pattern as literal text.
- `ignoreCase`: an optional boolean, default `false`.
- `limit`: an optional integer from 1 to 20, default 20. It bounds the files
  in the inline part of the result.
- `objective`: an optional string of 1 to 2,000 UTF-16 code units. It states
  what the caller looks for. It MUST NOT change which lines match.

The tool MUST compile each pattern with RE2 syntax through a linear-time
engine. When the engine rejects a pattern, the tool MUST fail the call as
`invalid_pattern` with the engine message and the pattern index. The tool
MUST NOT run an engine that backtracks. The tool MUST NOT rewrite a rejected
pattern. The tool MUST NOT record a `native.attempt` effect, because it
mutates nothing.

#### Scenario: Unknown property is refused

- **WHEN** the model submits `{ "patterns": ["x"], "include": "*.ts" }`
- **THEN** the tool returns `invalid_input`
- **AND** no scope is admitted and no file is opened

#### Scenario: Backreference is refused by the engine

- **WHEN** a pattern is `(a)\1`
- **THEN** the tool returns `invalid_pattern` with the engine message and index `0`
- **AND** no scope is admitted and no file is opened

#### Scenario: Literal mode keeps metacharacters

- **WHEN** `literal` is `true` and a pattern is `a.b(`
- **THEN** only lines that contain the text `a.b(` match

#### Scenario: Nine patterns are refused

- **WHEN** `patterns` holds nine strings
- **THEN** the tool returns `invalid_input`

#### Scenario: A cursor is refused

- **WHEN** the model submits `{ "patterns": ["x"], "cursor": "abc" }`
- **THEN** the tool returns `invalid_input`

#### Scenario: No native attempt is recorded

- **WHEN** a grep call runs over a host scope
- **THEN** no `native.attempt` event is appended

#### Scenario: An objective longer than 2,000 code units is refused

- **WHEN** the model submits an `objective` of 2,001 UTF-16 code units
- **THEN** the tool returns `invalid_input`
- **AND** no scope is admitted and no file is opened

#### Scenario: An objective changes no match

- **WHEN** one call runs twice over one scope, with an `objective` and without one, and no rerank model is configured
- **THEN** both results hold the same passages
- **AND** both results carry the same `warnings` and the same `complete`

### Requirement: Passages follow scope order and walk order

The tool MUST order passages by resolved scope ordinal, then by canonical
order of the walk, then by passage start line. The inline part and the
artifact MUST use this one order.

When `tools.grep.rerank.model` names a model and the result does not fit the
inline part, the tool MUST rank whole file runs. The ranked order then
replaces the scope and walk order of those runs. The passages of one run MUST
keep their order. A run MUST stay contiguous. The inline part, the artifact
text, and the artifact findings MUST use that one ranked order.

#### Scenario: A later file that ends first keeps its place in the artifact

- **WHEN** `b.ts` ends before `a.ts`, both files match, and the result has an artifact
- **THEN** the passages of `a.ts` come before the passages of `b.ts` in the artifact

#### Scenario: Ranked runs keep their passages together

- **WHEN** a walk gives two passages each for `a.ts`, `b.ts`, and `c.ts`, and the rank puts `c.ts` first
- **THEN** the two passages of `c.ts` come first and stay together
- **AND** the passages of `a.ts` and `b.ts` follow in that order

#### Scenario: No rerank model keeps the walk order

- **WHEN** `tools.grep.rerank` is absent and 30 files match
- **THEN** the passages follow the scope ordinal, the canonical order of the walk, and the passage start line

### Requirement: Reads run concurrently and keep canonical order

The walk MUST NOT have more than 8 files open for a match at the same time, or
more than a configured file bound leaves. When more candidates wait in
canonical order, the walk MUST have 8 files open, or as many as that bound
leaves. The walk, each bound, each skip count, and each excluded directory
MUST take effect in canonical order. The inline part and the artifact MUST
follow the result order that `Passages follow scope order and walk order`
defines. That order is canonical unless a ranked order applies. A file opened
ahead of a stop MUST NOT count as reached.

#### Scenario: Eight reads are in flight

- **WHEN** a scope holds 20 candidates and each read waits until the test releases it
- **THEN** 8 reads are in flight at the same time, and no more

#### Scenario: A later file that ends first keeps its place

- **WHEN** `b.ts` ends before `a.ts` and both files match
- **THEN** the passages of `a.ts` come before the passages of `b.ts`

#### Scenario: A stop discards files opened ahead

- **WHEN** the call deadline stops the walk after `c.ts` and the walk has opened `d.ts` to `h.ts` ahead
- **THEN** the result holds no passage of `d.ts` to `h.ts`
- **AND** the result does not count `d.ts` to `h.ts` as examined

#### Scenario: Read-ahead does not exceed the file bound

- **WHEN** `tools.grep.maxFilesExamined` is 3
- **THEN** the walk opens no more than 3 files for a match in the call

#### Scenario: Files before an entry bound are still searched

- **WHEN** the entry bound trips while three earlier candidates are open
- **THEN** the walk takes those three files before it stops
- **AND** the result holds the passages of those three files, if any

#### Scenario: A read refusal counts only for a taken file

- **WHEN** the `read` group refuses a file that the walk admitted ahead, and the call deadline stops the walk before it takes that file
- **THEN** the completion audit does not count that refusal

#### Scenario: A ranked order leaves the walk effects in canonical order

- **WHEN** a rank puts the last of 30 runs first and a bound stops the walk after the 30th run
- **THEN** the bound, the skip counts, and the excluded directories match the same walk without a rank
- **AND** the inline part and the artifact follow the ranked order

### Requirement: The excluded-directory report is filtered and bounded

The `read` group MUST admit a directory locator both as written and with a
final separator before the result counts or names it. The walk MUST record at
most 1,000 excluded directories for one call, across every scope. When it
excludes more, `ignored.atLeast` MUST be `true`. The inline part MUST reserve
room for the `ignored`, `unfinishedFile`, remainder, artifact notice, and
`[ranking unavailable; walk order]` lines. This reserve prevents a cut by the
tool loop.

#### Scenario: A refused directory is not named

- **WHEN** an ignore rule excluded `/home/u/repo/secrets` and the `read` group refuses that locator
- **THEN** `ignored` neither counts nor names `/home/u/repo/secrets`

#### Scenario: A reject with a final separator hides the directory

- **WHEN** an ignore rule excluded `/home/u/.ssh` and the `read` group rejects the literal `/home/u/.ssh/`
- **THEN** `ignored` neither counts nor names `/home/u/.ssh`

#### Scenario: Only refused exclusions leave no report

- **WHEN** the only excluded directory is one that the `read` group refuses
- **THEN** the result carries no `ignored` field

#### Scenario: A large exclusion count is a lower bound

- **WHEN** ignore rules exclude 1,500 directories in one call and the `read` group admits each of them
- **THEN** `ignored.count` is 1,000 and `ignored.atLeast` is `true`

#### Scenario: The ranking line has reserved room

- **WHEN** a call stores `ranking: "unavailable"` and its inline part is otherwise full
- **THEN** the inline part holds the `[ranking unavailable; walk order]` line
- **AND** the tool loop does not cut the result

## ADDED Requirements

### Requirement: The rank makes one card for each file run

The tool MUST make one card for each file run. A card MUST hold the file path
and up to three lines that match, inside 384 UTF-16 code units. Each key
MUST use the `p<index>` format. Its zero-based canonical index uses the width
of the last index, such as `p00` to `p29`. The tool MUST ask the decision
model about every card, with the call's `objective` when the call sets one.

#### Scenario: A refused file supplies no card

- **WHEN** a host walk and a `kb://space/app` walk each match one file that the `read` group refuses
- **THEN** the cards hold runs of admitted files only
- **AND** the refused paths appear in no card and in no passage of the result

#### Scenario: A card holds the path and three matching lines

- **WHEN** a file run holds six matching lines of under 100 units each and its path is 40 code units long
- **THEN** its card holds the path and the first three matching lines
- **AND** the card stays at or below 384 UTF-16 code units

### Requirement: A ranked order sorts the judged runs and changes nothing else

The tool MUST sort the judged runs by score, strongest first. A tie and an
unjudged run MUST keep the canonical order. The tool MUST NOT change a match,
a count, a warning, a bound, the walk stop, or an admission. A run MUST keep
exactly one `## <path>` line.

#### Scenario: Thirty files put three implementations first

- **WHEN** a walk over `/srv/app` gives 30 file runs, and three implementations score 0.9 while the other 27 runs score 0.05
- **THEN** the three implementations come first in the artifact and in the inline part
- **AND** the other 27 runs follow in the canonical order

#### Scenario: Equal scores keep the walk order

- **WHEN** two file runs both score 0.4
- **THEN** the run with the earlier canonical position comes first

#### Scenario: The stop and the counts do not change

- **WHEN** `tools.grep.maxFilesExamined` stops a walk at 5,000 files and the rank reorders its runs
- **THEN** the result carries `complete: false` and the same file bound warning
- **AND** the result counts the same passages and skips as the same walk without a rank

#### Scenario: One heading for one run

- **WHEN** a run of `c.ts` holds three passages in one scope and the rank moves it first
- **THEN** its three passages follow one `## c.ts` line
- **AND** no other `## c.ts` line appears in the text

### Requirement: Ranking runs only when the model cannot see the whole result

A result fits the inline part when it holds at most `limit` files and its
text stays at or below 15,000 UTF-16 code units. The tool MUST NOT call the
decision model when the whole result fits the inline part. No other condition
stops the call: the tool sets no minimum number of file runs.

#### Scenario: A small result costs nothing

- **WHEN** three files match, one run each, and the text stays under 15,000 units
- **THEN** the text follows the canonical order
- **AND** the tool makes no decision call and the result carries no `display.rerank`

#### Scenario: Two long runs are ranked

- **WHEN** two file runs overfill the inline part and `tools.grep.rerank.model` names a model
- **THEN** the tool makes one decision call for the two cards
- **AND** the text follows the ranked order

### Requirement: A ranking failure keeps walk order and says so

When the decision model answers for no card, the tool MUST keep the canonical
order. The tool MUST then store the output field `ranking` with the value
`"unavailable"`. The text of the field is specified by `tool-result-rendering`.
When the model answers for some cards only, the tool MUST rank the judged runs
and keep each unjudged run in the canonical order. The tool MUST NOT store the
`ranking` field then. A call that stores `ranking` MUST store no
`display.rerank` record.

#### Scenario: An unreachable endpoint keeps the walk order

- **WHEN** the decision endpoint refuses every request of a 30-run call
- **THEN** the text follows the canonical order
- **AND** the output carries `ranking: "unavailable"` and no `display.rerank`
- **AND** `complete`, `warnings`, and the counts are unchanged

#### Scenario: A partial answer ranks the judged runs

- **WHEN** one request of a 300-card call fails and the other cards carry scores
- **THEN** the judged runs sort by score and the unjudged runs follow in the canonical order
- **AND** the output carries no `ranking` field
