# Anchor-Word Permutation Composition Spec

Date: 2026-09-20

Source of truth for behavior: `anchor-word-requirements.md` (the "requirements
doc"). This spec was written from that document alone. Where this spec makes a
choice the requirements doc leaves open, the choice is marked as a decision and
listed under `Sign-Off Decisions` or `Open Decisions Deferred`.

## Purpose

Build a command-line tool that turns one anchor word into a one-page
typographic composition of that word's permutations and delivers it as a single
`.docx` document.

This matters to the user because the composition is an artwork: the anchor is
the only intended word among all rearrangements of its letters, and the page
must show every rearrangement exactly once, in a controlled order and layout,
with nothing added and nothing lost. A run either delivers a document that has
been verified to fit on one page or delivers nothing.

## Goals

- Accept an anchor word of any positive length with distinct permitted
  characters and derive everything else (`N`, `N!`, band counts, stage counts,
  default grid) from it.
- Produce every permutation exactly once in ordinary mode, with the anchor at a
  requested or derived index.
- Support the five ordering and visibility modes of the requirements doc:
  default random ordering, X-off ordering, Acrostic, hidden anchor, and Slot
  Machine (strict or all-permutations coverage).
- Support the three layouts (`FullPageGrid`, `CenteredGrid`,
  `RandomPositions`) and the continuous no-word-spacing stream.
- Make the permutation sequence depend only on ordering-related settings, so the
  user can restyle a composition without changing which word lands where.
- Verify fit on one page from font metrics before anything is written.
- Report every configuration conflict in one pass, with messages that name the
  settings, the rules, the calculated values, and a correction.
- Write exactly one `.docx` file, never replace an existing file without
  explicit permission, and never leave a partial or unverified artifact.
- Provide `--help` and a structured success report.

## Non-Goals

- No graphical or API interface in this version. The CLI is the only interface.
- No cross-implementation identity of pseudorandom sequences. Reproducibility is
  guaranteed within this implementation only.
- No output formats other than `.docx`. PDF rendering, if added later, is an
  internal verification artifact and never a product output.
- No multi-page compositions. A request that cannot fit on one page is rejected.
- No automatic reconciliation of conflicting settings. Conflicts are errors.
- No font substitution. If the configured font cannot be measured, the request is
  rejected.

## Product Direction

The tool is a single command, tentatively named `anchor-word`, invoked with
options that map one-to-one onto the settings table in the requirements doc
(section 5). The run proceeds in fixed phases, each of which can reject the
request, and only the last phase touches the file system:

1. parse the command line into a request that records, for every setting,
   whether the value was supplied explicitly or is a default;
2. validate the configuration and report every detectable conflict at once;
3. compute counts (permutations, bands, stages, grid) with overflow-checked
   integer arithmetic;
4. verify fit against the page geometry using measured font metrics;
5. build the permutation sequence (and, for random positions, the placement);
6. serialize the document in memory;
7. open the destination under the file-safety rules and write the bytes;
8. print the success report.

The implementation language and the document, font-metrics, and CLI libraries
are not pinned by the requirements doc. They are listed under `Open Decisions
Deferred` and must be chosen before the execution plan is written. Module names
below are responsibility names; file extensions follow the chosen language.

## Domain Model

Names follow the requirements doc so that a reader of either document finds the
same vocabulary. All domain types are immutable values unless stated otherwise.

### `AnchorWord`

The validated source word. Construct only through a parsing constructor that
takes the raw text and returns either an `AnchorWord` or an `AnchorError` that
names the offending character and its one-based position. Rules enforced at
construction:

- at least one character;
- every character is in the permitted set: ASCII letters `A`–`Z` and `a`–`z`,
  digits `0`–`9`, and the punctuation marks `.` `,` `;` `:` `?` `!` `'` `"`
  `-` `(` `)`;
- all characters distinct, case-sensitively.

Exposes `length` (`N`), the character at a one-based position, and
`permutationCount` (`N!`). Once an `AnchorWord` exists, no later code re-checks
these rules.

### `Permutation`

A sequence of `N` characters that is a rearrangement of an `AnchorWord`. Knows
its `firstCharacter` and can compute its `xOffValue` against the anchor (number
of positions whose character differs from the anchor's character at the same
position). Two permutations are equal when their text is equal.

### `PermutationSet`

All `N!` permutations of an anchor, generated once, in a fixed canonical order
(lexicographic over anchor positions) so that every later seeded choice starts
from the same list. Provides `byXOffBand(k)` and predicates used by Slot Machine
stage membership (`isCorrectAt(position)`).

### `XOffBand` and `XOffOrder`

An `XOffBand` is an integer in `{0} ∪ {2, …, N}`. The band count for `k` is
`C(N, k) × !k` (derangement number of `k`). An `XOffOrder` is a validated
sequence containing every valid band exactly once. It exposes
`derivedAnchorIndex` = `1 + sum of counts of bands preceding band 0` and the
per-band counts used in error messages.

### `LockOrder`, `SlotMachineCoverage`, `SlotMachineStages`

A `LockOrder` is a validated list of exactly `N − 1` distinct one-based anchor
positions; construction fails for `N = 1`. `SlotMachineCoverage` is the
enumeration `StrictDerangements | AllPermutations`. `SlotMachineStages`
partitions a `PermutationSet` into `N` disjoint ordered stages according to a
lock order and coverage (rules in `Slot Machine` below) and exposes the stage
counts and total.

### `AnchorIndex`

A one-based position `1 … outputCount`. In ordinary random ordering it is
requested or defaults to `N!`. With an X-off order it is derived. In Slot
Machine mode it is the last item.

### `AcrosticTarget`

A non-empty string of characters, validated against an anchor (every character
present in the anchor, case-sensitively) and against a row count (length not
greater than the number of rows). Defaults to the anchor word.

### `GridShape`

`rows × columns` with `rows × columns = outputCount`. Provides
`closestToSquare(count)` (smallest `rows − columns` with `rows ≥ columns`) and
`defaultForOrdinary(N, count)` (3 columns when `3` divides `count` and `N ≤ 4`,
otherwise closest-to-square). Records whether the shape was explicit or
automatic for the success report.

### `Layout`

The enumeration `FullPageGrid | CenteredGrid | RandomPositions`, plus the
`noWordSpacing` mode, which replaces a grid layout with a continuous stream.
The `Layout` value knows its file-name segment: `full-page`, `centered-grid`,
`random-positions`.

### `CompositionSequence`

The finished ordered list of permutations (the "generation sequence"), the
anchor's index, the anchor's visibility, and, in Slot Machine mode, the stage
boundaries. This is the sole input to layout and output; nothing downstream
recomputes ordering.

### `Placement`

For `RandomPositions` only: for each sequence index, the top-left corner of an
item area of the configured width and height, in points relative to the
usable-area origin.

### `Setting<T>` and `CompositionRequest`

Every configurable value is carried as a `Setting<T>` with `value` and
`source ∈ {Explicit, Default}`. `CompositionRequest` is the record of all
settings from the requirements doc's section 5 table, each as a `Setting`. This
shape exists because the requirements doc's compatibility rules distinguish an
explicitly supplied value from a default (§5.2), and a plain value cannot carry
that distinction.

Design alternatives considered and rejected:

- A flat record with optional fields where "absent" means default. Rejected
  because the anchor index has a real default (`N!`) that is *also* forbidden
  when explicit under X-off ordering; an absent-or-value model cannot express
  "defaulted to 24" versus "user typed 24".
- Reusing raw strings for anchor, X-off order, and lock order throughout.
  Rejected: every consumer would re-validate, and the derived-index and band
  count rules would be re-encoded in several places. Parse once at the boundary
  into typed values.

### State ownership

Everything is in-memory and per-run. There is no persistent state, no
configuration file, and no database. The only durable side effect is the
output document.

## Architecture

The code is layered by responsibility. Dependencies point inward: interface →
application → domain and layout; ports are defined by the inner layers and
implemented by adapters at the edge.

### Interface layer: `cli`

- Parses arguments into a `CompositionRequest` with provenance.
- Prints `--help` and exits without touching the file system.
- Prints the success report to standard output and errors to standard error.
- Maps outcome kinds to exit codes: `0` success; `1` request rejected
  (validation, fit, sequence construction, placement); `2` output-destination
  errors; `3` platform failures (font unavailable, save failure, verification
  rendering failure).

### Application layer: `composition-service`

Owns the run workflow listed under `Product Direction`. It calls the validator,
the counters, the fit verifier, the sequence builder, the placer, the document
writer, and the destination, in that order, and stops at the first failing
phase. It holds no domain rules of its own.

### Domain layer: `domain/*`

Pure, deterministic, dependency-free modules:

- `domain/anchor-word` — `AnchorWord`, `Permutation`, `PermutationSet`.
- `domain/x-off` — `XOffBand`, `XOffOrder`, band counts, derived anchor index.
- `domain/slot-machine` — `LockOrder`, `SlotMachineCoverage`,
  `SlotMachineStages`, stage counts.
- `domain/acrostic` — `AcrosticTarget` and the row-start assignment solver.
- `domain/grid` — `GridShape`.
- `domain/sequence-builder` — builds a `CompositionSequence` from a validated
  plan and a `SeededRandom`.
- `domain/seeded-random` — a small, self-contained 32-bit generator (decision
  below) and a Fisher–Yates shuffle.
- `domain/counts` — overflow-checked factorial, derangement, and binomial
  arithmetic.

### Configuration layer: `config/validation`

Turns a `CompositionRequest` into a `CompositionPlan` (typed, validated, all
defaults resolved) or a list of `ConfigurationConflict` values. Validation
reports every conflict detectable from the configuration alone.

### Layout layer: `layout/*`

- `layout/page-geometry` — page size, margin, usable area.
- `layout/fit-verifier` — the checks in `Fit Verification`, using the
  `FontMetricsSource` port.
- `layout/random-placer` — bounded-attempt seeded placement for
  `RandomPositions`.

### Ports (interfaces owned by the inner layers)

- `FontMetricsSource` — given a font family and size, returns the natural line
  height and the advance width of a character, or reports that the family is
  unavailable.
- `DocumentWriter` — given a `CompositionPlan`, `CompositionSequence`, and
  optional `Placement`, returns the document bytes.
- `OutputDestination` — resolves, checks, creates directories for, and writes
  the destination under the file-safety rules.

### Adapters

- `output/docx-writer` — implements `DocumentWriter` for `.docx`.
- `fonts/font-file-metrics` — implements `FontMetricsSource` from installed
  font files.
- `output/file-destination` — implements `OutputDestination` on the local file
  system.

Adapters are injected into `composition-service` so the workflow and the domain
can be tested with fakes.

## Command-Line Surface

Option names are the CLI's rendering of the settings table. Enumerated values
are accepted case-insensitively and reported in their canonical spelling.

| Option | Value | Default |
|---|---|---|
| `--anchor` | anchor word | `mine` |
| `--anchor-index` | integer `1..N!` | `N!` |
| `--hide-anchor` | flag | off |
| `--x-off-order` | bands separated by `-` or `,`, e.g. `4-3-2-0` | none |
| `--lock-order` | positions separated by `,` or `-`, e.g. `3,2,4` | none |
| `--coverage` | `StrictDerangements` or `AllPermutations` | `StrictDerangements` |
| `--layout` | `FullPageGrid`, `CenteredGrid`, `RandomPositions` | `FullPageGrid` |
| `--columns` | positive integer | automatic (see `Grid Selection`) |
| `--acrostic` | flag | off |
| `--acrostic-target` | string | anchor word |
| `--no-word-spacing` | flag | off |
| `--seed` | integer `0..4294967295` | `20260908` |
| `--font-family` | font family name | `Times New Roman` |
| `--font-size` | points, `8..100` | `35` |
| `--page-width` | points, `100..2000` | `595.3` |
| `--page-height` | points, `100..2000` | `841.9` |
| `--margin` | points, `0..144` | `18` |
| `--cell-width` | points, `20..300` | `84` |
| `--row-height` | points, `20..300` | natural line height |
| `--item-width` | points, `20..300` | `92` |
| `--item-height` | points, `20..300` | `52` |
| `--min-gap` | points, `0..100` | `8` |
| `--output` | path ending in `.docx` | `<anchor>-<layout>.docx` in the current working directory |
| `--overwrite` | flag | off |
| `--help` | action | — |

Representative call sites (these must read naturally and be the correct way to
ask for each result):

    anchor-word
    anchor-word --x-off-order 4-3-2-0 --no-word-spacing
    anchor-word --acrostic --columns 6
    anchor-word --lock-order 3,2,4
    anchor-word --lock-order 3,2,4 --coverage AllPermutations --x-off-order 4-3-2-0 --columns 3
    anchor-word --anchor cat --layout CenteredGrid --output poems/cat.docx --overwrite

Flags are used only for on/off modes whose off state is the plain composition.
No option changes the meaning of another option's value.

## Configuration Validation

Validation runs on the `CompositionRequest` before any counting, measuring, or
generation. It collects every conflict it can detect and returns them together.

### Value validation

- Anchor: the `AnchorWord` rules; the error names the character and position.
- Numeric ranges from the settings table; the error names the setting, the
  value, and the range.
- Margin: `2 × margin < page width` and `2 × margin < page height`; the error
  gives the resulting usable dimensions.
- X-off order: must contain `0` and every integer `2..N` exactly once and nothing
  else; the error lists the valid bands for this `N`.
- Lock order: exactly `N − 1` distinct positions in `1..N`; rejected outright
  for `N = 1`. Separate messages for wrong count, repeated position, and
  out-of-range position.
- Anchor index: `1..N!` when applicable.
- Columns: positive and an exact divisor of the output count; the error states
  the output count and the divisors.
- Acrostic target: non-empty; every character present in the anchor with
  matching case; length not greater than the row count; no character required
  more times than `(N − 1)!`.
- Output: file name ends in `.docx` (case-sensitive `.docx`); the tool never
  appends or changes the extension.

### Inapplicable explicit settings (§5.2)

Each of the following is a conflict only when the listed setting is `Explicit`;
a default is ignored silently. The message names the setting, the mode that
makes it inapplicable, and the setting that selects that mode.

- `--coverage` without `--lock-order`.
- `--acrostic-target` without `--acrostic`.
- `--anchor-index` with `--x-off-order`. The message additionally gives the
  requested order, the requested index, the derived index, and the band counts
  that explain it.
- `--anchor-index` with `--lock-order`. The message states that the anchor is
  always the final item.
- `--columns` with `--layout RandomPositions` or with `--no-word-spacing`.
- `--cell-width` or `--row-height` with any layout other than `CenteredGrid`.
- `--item-width`, `--item-height`, or `--min-gap` with any layout other than
  `RandomPositions`.

### Incompatible modes (§11)

- `--x-off-order` with `RandomPositions`.
- `--acrostic` with `RandomPositions`, with `--no-word-spacing`, or with
  `--lock-order`.
- `--hide-anchor` with `--lock-order`.
- `--lock-order` with `RandomPositions`.
- `--no-word-spacing` with `RandomPositions`.

### Anchor and acrostic interaction (§7.3)

When Acrostic is on and the anchor's index is the first position of a
constrained row, the anchor's first character must equal the target character
for that row and `--hide-anchor` must be off. Both checks are configuration-
detectable (the anchor index is known or derived before generation) and are
reported here.

### Destination pre-check

If the resolved destination exists and `--overwrite` is off, validation reports
"destination already exists" with the requested and resolved paths. The check is
repeated at write time.

## Counting and Capacity

`domain/counts` computes with 64-bit checked integer arithmetic: `N!`, `!k`,
`C(N, k)`, band counts, stage counts, and the output count. `20!` fits; `21!`
does not. Any overflow rejects the request with the capacity error of §5.1,
which reports `N`, that the count exceeds arithmetic capacity, and a shorter
anchor as the correction. No additional maximum anchor length is imposed; the
fit verifier rejects long anchors in practice with a geometry-specific message.

Counts are computed from formulas, not by enumerating permutations, so the
`N = 5` default-typography case is rejected by the fit verifier before any
permutation is generated.

## Sequence Ordering

### Seeded randomness

`SeededRandom` is a small, self-contained 32-bit generator with a Fisher–Yates
shuffle, implemented in the project rather than taken from the runtime, so that
results stay identical across runtime upgrades. From the configured seed the
builder derives two independent streams by fixed constants: an ordering stream
and a placement stream. Ordering never consumes the placement stream and vice
versa. This is how the ordering-invariance rule (§3.6.1) is satisfied: the
ordering stream's consumption depends only on the anchor, seed, anchor index,
X-off order, lock order, coverage, acrostic target, and (when Acrostic is on)
the column count.

### Default random ordering

1. Fix the anchor at the anchor index.
2. Shuffle the other `N! − 1` permutations (in canonical order) with the
   ordering stream and fill the remaining positions in order.

### X-off ordering

1. Assign the sequence positions to bands: band by band in the requested order,
   each band occupying a contiguous block whose length is that band's count.
2. The anchor occupies the single position of band 0; this is the derived
   anchor index.
3. Shuffle each other band's permutations with the ordering stream, in the
   requested band order, and fill that band's block.

### Acrostic

The row-start assignment is a constraint problem, solved as bipartite matching
so that a satisfiable request is never rejected because a greedy pick failed:

1. Constrained positions are `1 + (r − 1) × columns` for rows `r = 1 … len(target)`.
2. If a constrained position equals the anchor index, the anchor satisfies it
   (validation already confirmed the initial matches and the anchor is
   visible); remove that position from the problem.
3. For each remaining constrained position, the candidate set is every
   non-anchor permutation whose first character is the target character for
   that row and, under X-off ordering, whose band is the band assigned to that
   position. Candidate lists are shuffled with the ordering stream before
   matching so unconstrained choices remain seeded.
4. Find a maximum matching between constrained positions and permutations
   (augmenting paths). If it does not cover every constrained position, stop
   with the acrostic error, listing the uncovered rows and their required
   initials, the anchor index, the X-off order, and the grid dimensions.
5. Fill all other positions by the default or X-off procedure using the
   permutations not consumed by the matching.

Rows beyond the target length have no constraint. Acrostic is grid-only, so
`columns` is known (explicit or automatic) before the solver runs.

### Slot Machine

Stage membership for lock order `SM[1..N−1]`:

- Stage 0 (initial): `SM[1]` incorrect; under `StrictDerangements` additionally
  every position incorrect (the `N`-off band).
- Stage `k` for `1 ≤ k ≤ N − 2`: `SM[1..k]` all correct and `SM[k+1]` incorrect.
  Positions not yet requested may be correct.
- Stage `N − 1` (final): the anchor alone.

Under `StrictDerangements`, permutations with `SM[1]` incorrect but some other
position correct belong to no stage and are omitted; the total is
`!N + (N − 1)!`. Under `AllPermutations` the stages partition all `N!`
permutations. Stage counts: `!N` or `N! − (N − 1)!` for stage 0, then
`(N − k)! − (N − k − 1)!` for each middle stage, then 1.

Ordering within stages: without X-off, shuffle each stage with the ordering
stream. With X-off, within each stage apply the band order to the bands present
in that stage, skipping absent bands, and shuffle within each band. The anchor
is always last; the derived-index rule does not apply. Stage boundaries are
recorded on the `CompositionSequence` for the report but have no visual marker.

Worked check that the implementation's tests must reproduce: anchor `mine`,
lock order `3,2,4`, strict → stage counts `9,4,1,1`, total 15; all-permutations
→ `18,4,1,1`, total 24; stage 1 contains `mnie`.

## Grid Selection

`outputCount` is `N!` in ordinary mode and the stage total in Slot Machine
mode. The hidden anchor counts.

- Explicit `--columns`: must divide `outputCount`; rows = `outputCount ÷ columns`.
- Automatic, ordinary mode, `N ≤ 4`: 3 columns when `3` divides `outputCount`,
  otherwise closest-to-square. Gives `1×1`, `2×1`, `2×3`, `8×3` for `N = 1..4`.
- Automatic, ordinary mode, `N ≥ 5`, and Slot Machine mode: closest-to-square.
  Gives `12×10` (120), `30×24` (720), `5×3` (15), `6×4` (24).

Automatic selection ignores whether the grid fits; fit is verified next.

## Fit Verification

Performed before generation with the `FontMetricsSource`. If the font family is
unavailable, the request is rejected naming the font; no other font's metrics
are substituted.

Measurements at the configured size:

- `lineHeight` = (ascent + descent + line gap) scaled to the font size (§3.9).
- `wordWidth` = sum of the advance widths of the anchor's characters. Because
  every permutation contains the same characters and kerning is disabled in
  the output document, every permutation has this width, so the widest
  permutation is known without enumerating permutations.
- `spaceWidth` = advance width of the space character.
- `usableWidth` = page width − 2 × margin; `usableHeight` likewise. For the
  comparisons below, both are reduced by a 1-point safety allowance to absorb
  rounding in the word processor's own layout.

Checks by layout (each failure names the limiting dimensions, the value that
exceeds them, and the controls to adjust):

- `FullPageGrid`: `columns × wordWidth + (columns − 1) × spaceWidth ≤
  usableWidth`; `rows × lineHeight ≤ usableHeight`.
- `CenteredGrid`: `cellWidth ≥ wordWidth`; `columns × cellWidth ≤ usableWidth`;
  `columns × wordWidth + (columns − 1) × spaceWidth ≤ columns × cellWidth` (so
  a row never wraps inside its bounded width); `rowHeight ≥ lineHeight`;
  `rows × rowHeight ≤ usableHeight`.
- Continuous stream: `wordWidth ≤ usableWidth`; `wordsPerLine = floor(usableWidth
  ÷ wordWidth)`; `ceil(outputCount ÷ wordsPerLine) × lineHeight ≤ usableHeight`.
- `RandomPositions`: `itemWidth ≥ wordWidth`; `itemHeight ≥ lineHeight`;
  `itemWidth ≤ usableWidth`; `itemHeight ≤ usableHeight`. Whether all items can
  be placed is decided by the placer.

The verified page count is 1 when all checks pass; that is the number the
success report prints. Optional rendering-based verification (for example to
PDF) is out of scope for this version; if added later it must be an internal,
deleted artifact and its failure must reject the request (§12).

## Random Placement

For `RandomPositions`, `layout/random-placer` places items in generation-sequence
order:

1. For each item, draw up to `attemptBudget` candidate top-left corners from the
   placement stream, uniformly within `[0, usableWidth − itemWidth] ×
   [0, usableHeight − itemHeight]`.
2. Accept the first candidate whose item area is at least `minGap` from every
   already-placed area (axis-aligned rectangle distance).
3. If the budget is exhausted for any item, stop with the placement error,
   naming the item index reached, the budget, and recommending smaller item
   dimensions, a smaller gap, a larger page, or a different seed.

`attemptBudget` is 10,000 per item (decision). With the same seed and inputs the
placer succeeds with the same placement or fails at the same item.

## Hidden Anchor

Decision: the anchor is hidden by writing it as an ordinary run in the page
background color (white, `FFFFFF`), in the same font and size as every other
permutation (§8.1 mechanism 2). The document format's native hidden-text
property is not used, because it removes the run from layout when hidden text
is not displayed and is dropped on export, which violates the footprint and
searchability requirements. Consequences that are correct by design:

- the anchor keeps its position, width, and line-breaking behavior;
- in the continuous stream a gap the width of the anchor is visible;
- the text remains selectable, searchable, and available to accessibility tools.

## Document Output

`output/docx-writer` produces a single-section document:

- page size and margins from the request; kerning off; all runs in the
  configured family and size, regular weight, upright, black except the hidden
  anchor;
- paragraph spacing before and after set to zero; line spacing set to exactly
  `lineHeight` (or `rowHeight` for `CenteredGrid`);
- no borders, shading, decorations, or empty paragraphs.

Per layout:

- `FullPageGrid`: one centered paragraph per row, words joined by one ordinary
  space; the section is vertically centered so the row block is centered on the
  page.
- `CenteredGrid`: one paragraph per row with left and right indents of
  `(usableWidth − columns × cellWidth) ÷ 2`, centered alignment inside that
  bounded width, exact line height `rowHeight`; section vertically centered.
- Continuous stream: one left-aligned paragraph; adjacent permutations are
  joined by a zero-width space (U+200B) so the word processor may break lines
  only between permutations and shows no separator; section vertically
  centered.
- `RandomPositions`: one paragraph per item, positioned as an absolutely placed
  text frame of `itemWidth × itemHeight` anchored to the margin area at the
  placer's coordinates, text horizontally and vertically centered within the
  frame, never rotated.

Reading order in the file matches the generation sequence in every layout, so
selection and search follow the sequence even where the visual order is random.

## Destination Handling and File Safety

`output/file-destination`:

- Resolves a relative `--output` against the current working directory and
  reports both requested and resolved paths in errors.
- Default file name: `<anchor>-<layout>.docx`; anchor characters the platform
  forbids in file names are replaced by `_` (on Windows: `"`, `:`, `?`, and any
  other reserved character; `,` and `-` are permitted). Default location: the
  current working directory.
- The document is fully serialized in memory before the destination is opened.
- Missing directories are created only at write time, after all verification.
- Without `--overwrite`, the destination is opened in create-new mode; if it
  exists the request is rejected and the file is untouched.
- With `--overwrite`, the destination is opened for exclusive write; if it is
  locked, open, or not writable, the open fails and the file is untouched.
- The bytes are written in one operation. No temporary or sidecar file is ever
  created in the destination directory.
- A failure after the file was opened for overwrite is reported as a document
  save failure with the platform error; this is the only case in which the
  destination can be left inconsistent, and the message says so.

## Error Handling and Fail-Fast Design

Errors are values, not exceptions escaping to the user. Two families:

- Expected failures (`RequestRejected`): configuration conflicts, capacity,
  fit, acrostic infeasibility, placement exhaustion, and destination rules.
  Each carries the setting names and values involved, the rule each imposes,
  why they conflict, the calculated values (derived index, band counts, row
  count, stage counts, usable dimensions), and at least one correction. The
  CLI prints them as a numbered list and exits with code `1` (or `2` for
  destination errors).
- Platform failures (`PlatformFailure`): font unavailable, save failure, and,
  if ever added, verification rendering failure. Each names the failed step
  and includes the underlying platform error. Exit code `3`.

Phase ordering guarantees no partial success: nothing is written before fit
verification and sequence construction succeed. Validation reports all
configuration conflicts at once; construction and placement stop at the first
failure they can detect only by running.

File-output errors are distinct kinds with distinct messages: destination
exists without overwrite; destination locked or not writable; output directory
cannot be used; file name does not end in `.docx`; verification rendering
failure; document save failure.

## Help and Success Reporting

`--help` prints every option with default and range or values, explains
reading order (left to right, then top to bottom), the permitted character set,
one-based indexing, the X-off and Slot Machine semantics, the incompatibility
table, and the representative call sites above. It exits `0` without touching
the file system.

On success the CLI prints, one field per line: resolved destination; page count
(1); total and unique permutation counts; anchor word, index, and visibility;
ordering mode; when applicable, lock order, coverage, stage counts, and X-off
bands per stage; layout, rows, columns, and whether the grid was explicit or
automatic; spacing mode; acrostic state and resolved target; seed; font family
and size.

## Testing Expectations

Tests are named by scenario and entry point and use concrete expected values.

Unit tests on the pure domain and layout modules:

- `AnchorWord` parsing: `mine`, `cat`, `a`, `ab`, `a1,-` accepted; `mi ne`,
  `miné` (character named, position 4), duplicates, and empty rejected.
- Band counts for `N = 1..6`; derived anchor index for `4-3-2-0` (24) and
  `0-2-3-4` (1); rejection of orders with `1`, omissions, or repeats.
- Stage counts: `mine`/`3,2,4` → `9,4,1,1` and `18,4,1,1`; `cat` → `2,1,1` and
  `4,1,1`; `ab` → `1,1`; lock order rejected for `a`.
- Stage membership: `mnie` is in stage 1 for `3,2,4`; stages are disjoint;
  all-permutations stages partition `N!`.
- Grid selection: `1×1`, `2×1`, `2×3`, `8×3`, `12×10`, `30×24`, `5×3`, `6×4`,
  and `8×3` for 24 items with explicit 3 columns.
- Sequence invariants under every mode: all `N!` present once (or strict Slot
  Machine subset with no repeats), anchor once at the expected index, bands
  contiguous in requested order, same seed → same sequence, different layout or
  font → same sequence.
- Acrostic: `mine`, six columns, default target → row starts `m,i,n,e`;
  target `xine`, `minee`, and `Mine` with target `mine` rejected; a satisfiable
  X-off + acrostic case that a greedy assignment would fail is solved.
- Fit verifier with a fake `FontMetricsSource` using Times New Roman-like
  metrics: defaults pass; `abcde` with defaults fails on usable width, and the
  message names `N = 5`, 120, `12×10`, the exceeding dimension, and
  corrections.
- Random placer: reproducible placement; no overlaps; gap respected; bounded
  failure with the same seed.
- Validation collects multiple conflicts in one result; each §5.2 inapplicable
  setting and each §11 "No" combination is covered, including explicit anchor
  index 24 with `4-3-2-0` (message contains derived index 24 and band counts
  `9,8,6,1`).

Integration tests on the document adapter, inspecting the produced document's
XML rather than a rendering:

- default run: 24 runs in sequence order, 8 paragraphs, single spaces, page
  size `595.3 × 841.9` pt, margins 18 pt, no extra paragraphs;
- hidden anchor: the anchor run exists with white color and the same font and
  size, and no other run moved;
- continuous stream: one paragraph, zero-width spaces between words, no spaces;
- centered grid: indents and exact row height as computed;
- random positions: 24 framed paragraphs with the placer's coordinates.

File-safety tests in a temporary directory:

- existing destination without `--overwrite`: rejected, file byte-for-byte
  unchanged, error names the resolved path;
- with `--overwrite`: replaced;
- with `--overwrite` while another handle holds the file locked: rejected
  before replacement, file unchanged;
- `poem.txt` rejected; in every case no other file appears in the directory.

Goal-based verification, per repository guidance: the user-visible goal is "the
default run opens in a word processor as exactly one page showing the 24
permutations of `mine` in an 8 × 3 grid with `mine` last". Before the feature is
declared complete, open the produced default document and the scenarios 17.1
through 17.15 in a word processor and confirm one page and the described
appearance; record what was checked.

## Documentation Expectations

- The CLI's `--help` is the user reference and must stay in step with the
  settings table.
- A short `README` in the tool's folder: install, the five-line quick start,
  where the default output is written, and the exit codes.
- This project has no `docs/agent-docs/` knowledge base yet. The execution plan
  should create `docs/agent-docs/agent-architecture-map.md` describing the
  layers and ports above as its first documentation step.

## Sign-Off Decisions

The following choices go beyond the requirements doc and need the user's
confirmation:

1. The interface is a CLI named `anchor-word` with the option names in
   `Command-Line Surface`.
2. Hidden anchor uses white-colored ordinary text, not the format's native
   hidden-text property.
3. Randomness comes from a self-contained 32-bit generator with two derived
   streams (ordering, placement), not the runtime's default generator.
4. Random placement uses a budget of 10,000 attempts per item.
5. Fit verification applies a 1-point safety allowance to the usable area.
6. Rendering-based verification (PDF) is out of scope for the first version;
   fit is verified from metrics only.
7. Default output location is the current working directory.
8. Exit codes: `0` success, `1` request rejected, `2` destination error,
   `3` platform failure.
9. No maximum anchor length beyond 64-bit arithmetic capacity (`N ≤ 20`).

## Open Decisions Deferred

- Implementation language and runtime.
- The `.docx` library (or hand-written package writer) and the font-metrics
  library.
- Exact wording of help text and error messages beyond the required content.
- Whether the tool ships as a script, a package, or a single executable.

## Status

Draft awaiting user sign-off (created 2026-09-20).
