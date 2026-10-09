# Anchor-Word Permutation Composition — Requirements

**Status:** Baseline requirements  
**Scope:** Anchor words of any positive length whose characters are distinct  
**Purpose:** Define the observable behavior of an anchor-word permutation composition independently of programming language, user-interface technology, document library, or internal architecture.

## 1. Purpose and product intent

The product creates a one-page typographic composition from permutations of an anchor word. The anchor length, written as `N`, is derived from the anchor word rather than configured independently. The default anchor is `mine`, so the default value of `N` is 4.

The central artistic idea is that the anchor is the only intended word among all rearrangements of its letters. Every ordinary composition contains every permutation exactly once. Optional modes may control ordering, visibility, row initials, spatial arrangement, or a progressive “slot machine” locking sequence.

An implementation may expose these capabilities through a command line, graphical application, API, or another interface. The interface may use different control names, but the behavior and constraints in this document shall remain the same.

## 2. Normative language

The terms **shall**, **must**, and **must not** identify mandatory behavior. **May** identifies optional implementation freedom.

## 3. Core terminology

### 3.1 Anchor word

The source from which all permutations are formed. Its number of characters is the anchor length `N`.

A **character** is one of the following:

- an English letter, `A` through `Z` or `a` through `z`;
- a digit, `0` through `9`; or
- a punctuation mark used in ordinary English writing: period `.`, comma `,`, semicolon `;`, colon `:`, question mark `?`, exclamation mark `!`, apostrophe `'`, quotation mark `"`, hyphen `-`, and parentheses `(` `)`.

No other character is permitted. In particular, spaces, tabs, other whitespace, control characters, accented letters, and letters of other scripts shall be rejected with an error that names the offending character and its position.

The anchor:

- shall contain at least one character;
- shall contain only distinct characters;
- is case-sensitive, so `m` and `M` are distinct; and
- defaults to `mine`.

These constraints guarantee exactly `N!` unique permutations.

Character positions `1` through `N` count from the first character entered. Because every permitted character is written left to right, position 1 is always the leftmost character of a displayed word.

### 3.2 Permutation

A sequence of length `N` containing each character of the anchor exactly once.

### 3.3 Reading order

For grid layouts, reading order is left to right within a row and then top to bottom across rows. The output's paragraph direction shall be left to right. All sequence indices are one-based.

Grid dimensions are written as **rows × columns**. For example, a 4 × 6 grid contains four rows and six columns.

Random-position layout has no reader-visible reading order. Where an indexed sequence is needed before spatial placement, it is called the **generation sequence**.

### 3.4 Anchor index

The one-based sequence position occupied by the anchor.

- The default anchor index is `N!`, which places the anchor last. For the default anchor `mine`, this is index 24. The default applies only when no X-off order is supplied.
- When an X-off order is supplied, the anchor index is determined by that order (§6.2). The default is not applied, and an explicitly supplied anchor index shall be rejected (§5.2, §11).
- In a grid or continuous composition, it refers to ordinary reading order.
- In random-position layout, it refers to the generation sequence before seeded spatial placement; it does not imply a spatial reading position.
- In Slot Machine mode, the anchor index is fixed to the last generated item. An explicitly supplied anchor index shall be rejected (§11).

### 3.5 X-off value

The X-off value of a permutation is the number of character positions that differ from the anchor at the same positions.

For an anchor of length `N`, valid X-off values are `0` and every integer from `2` through `N`. A 1-off permutation is impossible.

The number of permutations in X-off band `k` is:

`C(N, k) × !k`

where `C(N, k)` selects the displaced positions and `!k` is the number of derangements of those positions.

For the default four-character anchor, the distribution is:

| X-off value | Meaning | Number of permutations |
|---:|---|---:|
| 0 | Every character is in its anchor position | 1 |
| 1 | Exactly one character is displaced | 0; this is impossible |
| 2 | Exactly two characters are displaced | 6 |
| 3 | Exactly three characters are displaced | 8 |
| 4 | No character is in its anchor position | 9 |

The anchor itself is the sole 0-off permutation.

### 3.6 Seed

A non-negative integer from `0` through `2^32 − 1` used to make random choices reproducible. The default seed is `20260908`.

For a given implementation, identical inputs and the same seed shall reproduce the same ordering and placement. Cross-implementation identity of pseudorandom sequences is not required unless a separate portable randomization profile is defined.

#### 3.6.1 Ordering invariance

The sequence of permutations shall depend only on the anchor, the seed, and the ordering-related settings: anchor index, X-off order, Slot Machine lock order and coverage, Acrostic and its target, and the column count when Acrostic is enabled. It shall not depend on font family, font size, page geometry, margins, layout, spacing mode, hidden-anchor state, or output settings. A user may therefore restyle a composition without changing which permutation appears where in the sequence.

Spatial placement in random-position layout may additionally depend on the page geometry, item dimensions, and minimum gap.

### 3.7 Output count

The number of items in the composition's sequence. In ordinary mode it is `N!`. In Slot Machine mode it is the total of the stage counts (§9.3). A hidden anchor is counted.

### 3.8 Closest-to-square exact-fill grid

Among all pairs of positive integers `(rows, columns)` with `rows × columns` equal to the output count and `rows ≥ columns`, the closest-to-square grid is the pair with the smallest value of `rows − columns`. A perfect-square count gives a square grid. A prime count gives `count × 1`. A count of 1 gives a 1 × 1 grid.

### 3.9 Natural line height

The single-line spacing of the configured font at the configured size, as given by the font's metrics: ascent plus descent plus line gap.

## 4. Global output invariants

### 4.1 Ordinary mode

Unless Slot Machine mode is enabled, the composition shall:

1. contain all `N!` permutations;
2. contain each permutation exactly once;
3. contain the anchor exactly once;
4. place the anchor at the requested anchor index; and
5. fit on exactly one page, as verified under §12.

If the anchor is hidden, it remains part of the `N!`-item sequence even though it is not visible.

### 4.2 Slot Machine mode

For anchors of length two or greater, Slot Machine mode may produce either a strict subset or all `N!` permutations, depending on its coverage option. In both cases:

1. no permutation shall appear more than once;
2. the displayed stages shall be disjoint;
3. the anchor shall appear exactly once;
4. the anchor shall be the final item; and
5. the composition shall fit on exactly one page, as verified under §12.

Stage boundaries have no visual marker. Stages follow one another in reading order and need not align with row boundaries.

### 4.3 Visual baseline

Unless an option explicitly changes spacing or placement, the result shall look like normally typed text:

- regular, upright, non-bold type;
- black visible text on a white page background;
- horizontal text, never rotated;
- no visible borders or background panels around the text;
- one ordinary space between adjacent words in a grid row;
- no added spaces beyond those separators;
- no empty rows;
- no added paragraph spacing before or after rows; and
- no decorative content unrelated to the composition.

## 5. Configuration requirements

The following table defines the language-neutral configuration surface. A user interface may present the controls differently.

| Setting | Type and valid values | Default | Requirement |
|---|---|---|---|
| Anchor word | One or more distinct, case-sensitive characters (§3.1) | `mine` (`N = 4`) | Source of all permutations; its length defines `N` |
| Anchor index | Integer 1–`N!` | `N!` | One-based anchor position (§3.4); may be supplied only in default random ordering, since X-off ordering and Slot Machine mode determine it |
| Hide anchor | Boolean | false | Makes the anchor visually invisible while preserving its place and footprint |
| X-off order | Ordering of `0` and every integer from `2` through `N`, each exactly once | none | Groups output by X-off bands |
| Slot Machine lock order | List of `N − 1` unique one-based character positions | none | Enables progressive locking when `N ≥ 2` |
| Slot Machine coverage | `StrictDerangements` or `AllPermutations` | `StrictDerangements` | Selects the first Slot Machine stage; valid only in Slot Machine mode |
| Layout | `FullPageGrid`, `CenteredGrid`, or `RandomPositions` | `FullPageGrid` | Selects spatial organization |
| Columns | Positive integer not greater than the output count | Ordinary mode with `N ≤ 4`: 3 when it exactly divides the output count, otherwise the closest-to-square exact-fill value. Ordinary mode with `N ≥ 5` and Slot Machine mode: the closest-to-square exact-fill value (§10.1, §9.5) | Number of words per grid row; must exactly divide the output count |
| Acrostic | Boolean | false | Constrains successive row initials |
| Acrostic target | Non-empty string | anchor word | Valid only when Acrostic is enabled |
| No word spacing | Boolean | false | Replaces a grid with a continuous, visibly unseparated character stream |
| Seed | Integer `0`–`2^32 − 1` | `20260908` | Controls reproducible random choices |
| Font family | Non-empty font-family identifier | `Times New Roman` | Typeface for every permutation; must be available for measurement (§12) |
| Font size | 8–100 points | 35 points | Type size for every permutation |
| Page width | 100–2000 points | 595.3 points | Default corresponds to A4 width |
| Page height | 100–2000 points | 841.9 points | Default corresponds to A4 height |
| Outer margin | 0–144 points | 18 points | Symmetric minimum inset from each page edge |
| Centered-grid cell width | 20–300 points | 84 points | Logical width allocated per column; valid only with `CenteredGrid` |
| Centered-grid row height | Optional 20–300 points | natural line height | Explicit row height when supplied; valid only with `CenteredGrid` |
| Random-position item width | 20–300 points | 92 points | Placement area width for each permutation; valid only with `RandomPositions` |
| Random-position item height | 20–300 points | 52 points | Placement area height for each permutation; valid only with `RandomPositions` |
| Random-position minimum gap | 0–100 points | 8 points | Minimum separation between item placement areas; valid only with `RandomPositions` |
| Output destination | Writable destination whose file name ends in `.docx` | `<anchor>-<layout>.docx` in a documented default location (§13.2) | The document output |
| Overwrite existing output | Boolean | false | Explicitly permits replacement |
| Help | Action | off | Describes all public controls and creates no composition |

The outer margin shall leave a positive usable width and height.

### 5.1 Length and capacity handling

An implementation may impose a documented maximum anchor length. Whether or not it does, before generation the system shall calculate the resulting permutation and stage counts without numeric overflow, and shall reject any length beyond its arithmetic capacity with the error described below.

Because `N!` grows rapidly, a particular request may exceed page geometry, memory, execution-time, document-format, or platform limits. In that case, the system shall reject the request before creating or replacing the final artifact. The error shall report:

- the anchor length `N`;
- the calculated output count, or the fact that it exceeds the implementation's arithmetic capacity;
- the limiting capacity or geometry; and
- one or more corrective options, such as a shorter anchor, smaller typography, larger page, different layout, or Slot Machine strict coverage.

The system must not silently truncate the permutation set or substitute a different anchor.

### 5.2 Explicit values versus defaults

For every setting, the system shall distinguish an explicitly supplied value from its default. This distinction is required by the anchor-index rules (§3.4, §6.2) and by the compatibility rules (§11).

Whenever explicitly supplied settings contradict one another, or one of them has no effect in the mode the others select, the request shall fail with an error that explains the conflict (§14). The system must never silently ignore, reconcile, or override a value the user supplied. Defaults of inapplicable settings, by contrast, are ignored silently.

An inapplicable explicit setting shall be rejected with an error that names the setting, the mode that makes it inapplicable, and the setting that selects that mode. The affected settings are:

- Slot Machine coverage without a lock order;
- Acrostic target without Acrostic;
- Anchor index with an X-off order or in Slot Machine mode;
- Columns with `RandomPositions` or with no-word-spacing mode;
- Centered-grid cell width and row height with any layout other than `CenteredGrid`; and
- Random-position item width, item height, and minimum gap with any layout other than `RandomPositions`.

## 6. Ordinary sequence ordering

### 6.1 Default random ordering

When neither X-off ordering nor Slot Machine mode is enabled:

1. the anchor shall be fixed at the requested anchor index;
2. the other `N! − 1` permutations shall be placed in seeded-random order in the remaining sequence positions; and
3. the random order shall not introduce duplicates or omit a permutation.

### 6.2 X-off ordering

X-off ordering shall accept `0` and every integer from `2` through `N`, each exactly once. Separators used by a particular interface may vary. For `N = 1`, the only band is `0`.

An X-off order that omits a valid band, repeats a band, or contains any other value, including `1`, shall be rejected with an error that lists the valid bands for the anchor length.

The composition shall place complete, contiguous X-off bands in the requested order. Within each band, permutations shall be ordered using the seed.

Because the 0-off band contains only the anchor, an X-off order determines the anchor index. The required index is:

`1 + the total number of permutations in all bands preceding the 0-off band`

For the default four-character anchor, `4-3-2-0` places the anchor at index `9 + 8 + 6 + 1 = 24`, and `0-2-3-4` places it at index 1.

When an X-off order is supplied, the derived index is used and the default of `N!` is not applied. An explicitly supplied anchor index is inapplicable and shall be rejected (§5.2). The error shall give:

- the requested X-off order;
- the requested anchor index;
- the anchor index that the order determines; and
- the band counts that explain the determined index.

This derivation does not apply in Slot Machine mode, where the anchor is always the final item (§9.4).

## 7. Acrostic mode

### 7.1 Acrostic result

Acrostic mode shall constrain the first permutation in reading order of successive grid rows so that their first characters spell the target from the first row downward.

- If no target is supplied, the target shall be the anchor word.
- Matching shall be case-sensitive. The target may contain only characters permitted by §3.1.
- If the grid has more rows than the target has characters, remaining rows shall have no acrostic constraint.
- Acrostic constraints shall not change the requirement that all `N!` permutations appear exactly once.
- All unconstrained choices shall remain seeded and reproducible.

Example: with anchor `mine`, six columns, and the default target, the result is a 4 × 6 grid whose row-start characters are `m`, `i`, `n`, and `e`.

### 7.2 Acrostic validity

The target:

- must contain at least one character;
- must not be longer than the number of grid rows;
- may contain only characters present in the anchor, with matching case; and
- may not require the same initial more times than available unique permutations can supply. For an anchor of length `N`, exactly `(N − 1)!` permutations begin with any particular anchor character.

The system shall find a sequence satisfying the acrostic, uniqueness, anchor-position, and any X-off constraints together. It must not reject a satisfiable request merely because a greedy assignment fails.

If no valid sequence exists, generation shall stop and identify the conflicting row starts, anchor position, X-off ordering, and grid dimensions.

### 7.3 Anchor interaction

If the anchor occupies the first position of a row constrained by the acrostic:

- its first character must equal the required acrostic character; and
- it must be visible.

Otherwise, the request shall be rejected with a corrective explanation. Hiding the anchor remains valid when the anchor is not the start of a constrained row.

## 8. Hidden-anchor mode

When the anchor is hidden:

1. it shall retain its normal sequence position;
2. it shall occupy exactly the same typographic space it would occupy if visible;
3. no other permutation shall move into its place;
4. it shall be visually invisible against the white page background; and
5. its underlying text shall remain present for selection, search, copying, and accessibility tools.

### 8.1 Hiding mechanism

The mechanism used to hide the anchor shall be chosen in this order of preference:

1. **A native invisible-text mechanism of the document format**, if the format provides one and it satisfies every requirement above. In particular, the hidden anchor must keep exactly the layout footprint, text flow, and line-breaking behavior it would have if visible, and must behave the same in any rendering used for verification (§12).
2. **Otherwise, ordinary text rendered in the page background color.** The anchor is written exactly as any other permutation, in the same font and size, with its color set to white. Because the run is ordinary text, flow, spacing, wrapping, and selection behave identically to a visible word.

A native mechanism that removes the text from the layout when hidden, collapses its width, or is dropped when the document is rendered or exported does not satisfy requirement 2 or 5 and shall not be used, even if the format labels it “hidden text”.

In continuous no-spacing mode, a hidden anchor leaves a visible gap of the anchor's width in the character stream. This is the intended result, not a defect.

Hidden-anchor mode is incompatible with Slot Machine mode because the Slot Machine progression must end in a visible anchor.

## 9. Slot Machine mode

### 9.1 Concept

Slot Machine mode models characters progressively locking into their correct anchor positions. It is available when `N ≥ 2` and receives an ordered list containing `N − 1` unique, one-based anchor positions. One position is omitted because the final remaining position becomes determined when the anchor is reached.

For lock order `SM[1] … SM[N − 1]`, output shall consist of `N` disjoint stages:

1. an initial stage in which `SM[1]` has not yet locked;
2. for each `k` from 1 through `N − 2`, a stage in which `SM[1] … SM[k]` are correct and `SM[k + 1]` is still incorrect; and
3. the anchor, in which every position is correct.

The explicit “next position is still incorrect” rule makes the stages disjoint and prevents repetition.

For clarity, fixing one position yields `(N − 1)!` raw permutations. The corresponding displayed Slot Machine stage contains fewer because permutations in which the next requested position is already correct belong to later stages. For `N = 4`, fixing one position yields six raw permutations, while that displayed stage contains four.

### 9.2 Lock-order validity

The lock order shall:

- contain exactly `N − 1` indices;
- use one-based positions 1 through `N`;
- contain no repeated position; and
- preserve the supplied order.

Slot Machine mode is unavailable for `N = 1`, where no progressive lock transition exists.

### 9.3 Coverage options

Coverage affects only the initial stage. In every later nonfinal stage, positions that have not yet been requested for locking may transiently be correct under either coverage option; only the positions `SM[1] … SM[k]` are required to be correct and only `SM[k + 1]` is required to be incorrect. This is deliberate: the two options differ solely in whether the initial stage admits permutations with any correct position.

#### StrictDerangements

The initial stage shall contain only `N`-off permutations: no position may already be correct.

Its count is the derangement number `!N`.

For each later nonfinal stage with `k` already locked positions, where `1 ≤ k ≤ N − 2`, the count is:

`(N − k)! − (N − k − 1)!`

The final anchor stage has one item. The strict total is therefore:

`!N + (N − 1)!`

For the default four-character anchor, the stage counts are:

| Stage | Constraint | Count |
|---:|---|---:|
| 0 | No character is correct | 9 |
| 1 | First requested position correct; second requested position incorrect | 4 |
| 2 | First two requested positions correct; third requested position incorrect | 1 |
| 3 | Anchor | 1 |
| **Total** |  | **15** |

For example, with anchor `mine` and lock order `3,2,4`, stage 1 contains `mnie`, in which position 1 is already correct although it is not yet requested. This is permitted.

#### AllPermutations

The initial stage shall contain every permutation in which the first requested lock position is incorrect. Other positions may transiently be correct. Its count is:

`N! − (N − 1)!`

Later stages use the same formula as StrictDerangements, and the final stage is the anchor. The stages shall partition all `N!` permutations.

For the default four-character anchor, the stage counts are:

| Stage | Constraint | Count |
|---:|---|---:|
| 0 | First requested position incorrect | 18 |
| 1 | First requested position correct; second requested position incorrect | 4 |
| 2 | First two requested positions correct; third requested position incorrect | 1 |
| 3 | Anchor | 1 |
| **Total** |  | **24** |

This coverage shall partition all `N!` permutations exactly once.

### 9.4 Slot Machine ordering within stages

Without X-off ordering, items inside each stage shall be seeded-random.

With X-off ordering:

1. Slot Machine stage order remains primary;
2. the requested X-off band order is applied independently within each stage;
3. X-off bands not present in a stage are skipped; and
4. items within each available band are seeded-random.

The anchor remains the final item regardless of where the `0` band appears in the X-off order, because the 0-off band occurs only in the final stage. The anchor-index derivation of §6.2 does not apply.

### 9.5 Slot Machine grid selection

If a column count is supplied, it must divide the Slot Machine output count exactly.

If no column count is supplied, the system shall choose the closest-to-square exact-fill grid defined in §3.8.

Examples:

- 15 items produce a 5 × 3 grid.
- 24 items produce a 6 × 4 grid.
- An explicit three-column layout for 24 items produces an 8 × 3 grid.

## 10. Layout requirements

### 10.1 Common page behavior

Every composition shall:

- occupy exactly one page;
- use the configured page dimensions;
- keep all content inside the outer-margin boundary;
- use the configured font family and size consistently; and
- reject geometry that would clip text, overlap required content, or create an additional page.

In ordinary mode, an omitted column count is chosen as follows:

- for `N ≤ 4`, three columns when three divides `N!`, otherwise the closest-to-square exact-fill grid defined in §3.8. This gives 1 × 1, 2 × 1, 2 × 3, and 8 × 3 for `N` = 1, 2, 3, and 4;
- for `N ≥ 5`, the closest-to-square exact-fill grid defined in §3.8. This gives 12 × 10 for `N = 5` and 30 × 24 for `N = 6`.

An explicitly supplied column count must divide the output count. The automatic choice does not consider whether the grid fits the page; fit is verified separately under §12, and a request whose automatic grid does not fit is rejected there.

In both grid layouts, a “column” is a word slot within a row. Rows are centered runs of words separated by single spaces, so word slots in different rows are not required to align vertically. Because every permutation contains the same characters, they align closely in practice.

### 10.2 Full-page grid

The full-page grid shall:

- use the full usable page width inside the outer margins;
- contain `output count ÷ columns` rows;
- center each row’s text across the usable width;
- vertically center the complete row block on the page;
- use natural line spacing with no added gap; and
- separate adjacent permutations with exactly one ordinary space.

The column count must divide the output count exactly.

### 10.3 Centered grid

The centered grid shall:

- contain `output count ÷ columns` rows;
- use a bounded row width equal to the configured logical cell width multiplied by the number of columns; the cell width has no other effect;
- use the configured row height, or natural line height when none is supplied;
- center the complete grid horizontally and vertically on the page;
- center each row’s text within the bounded row width;
- use no added line gap; and
- separate adjacent permutations with exactly one ordinary space.

The column count must divide the output count exactly.

### 10.4 Continuous no-spacing layout

When no-word-spacing mode is enabled:

- all sequence items shall appear as one continuous character stream;
- no visible separator shall appear between adjacent permutations;
- nonprinting break opportunities may be used so the stream can wrap cleanly, and line breaks shall occur only between permutations, never inside one;
- the stream shall use the usable page area;
- the text shall be left-aligned and vertically centered; and
- grid row and column dimensions shall not apply.

This mode explicitly overrides the normal one-space word separation. It is incompatible with Acrostic and RandomPositions but is valid with Slot Machine, X-off ordering, and hidden anchor (§8).

### 10.5 Random-position layout

Random-position layout shall place all `N!` ordinary-mode permutations at seeded-random locations within the usable page area.

Each permutation shall:

- occupy an area of the configured width and height;
- be visually centered within that area;
- be horizontal, never rotated;
- remain entirely inside the outer-margin boundary;
- not overlap another item’s area; and
- maintain at least the configured minimum gap from every other item’s area.

The placement search shall be bounded by a documented attempt budget so that it always terminates. With the same seed and inputs, it shall either succeed with the same placement or fail in the same way.

If no legal placement is found within the budget, generation shall stop with an error recommending changes to item dimensions, minimum gap, page geometry, or seed.

Random-position layout has no stable reading order and is therefore incompatible with X-off ordering, Acrostic, Slot Machine, and continuous no-spacing mode.

## 11. Compatibility rules

| Combination | Allowed? | Rule |
|---|---|---|
| X-off order + FullPageGrid | Yes | Bands follow reading order |
| X-off order + CenteredGrid | Yes | Bands follow reading order |
| X-off order + RandomPositions | No | Random placement has no stable reading order |
| X-off order + no word spacing | Yes | Bands follow the stream order |
| X-off order + Acrostic | Conditionally | All ordering, uniqueness, anchor, and row-initial constraints must be simultaneously satisfiable |
| X-off order + Slot Machine | Yes | X-off ordering applies inside each stage; anchor index is not derived from the order |
| X-off order + Hide anchor | Yes | The hidden anchor occupies the derived index |
| Explicit anchor index + X-off order | No | The order determines the index (§6.2) |
| Explicit anchor index + Slot Machine | No | The anchor is always the final item |
| Acrostic + either grid | Yes | Grid must have enough rows |
| Acrostic + RandomPositions | No | No explicit rows |
| Acrostic + no word spacing | No | No explicit first word per row |
| Acrostic + Slot Machine | No | Independent row-start constraints conflict with fixed disjoint stage membership |
| Hide anchor + Acrostic | Conditionally | Anchor must not be the first item of a constrained row |
| Hide anchor + Slot Machine | No | Final anchor must be visible |
| Hide anchor + RandomPositions | Yes | Anchor retains its seeded placement area but is invisible |
| Hide anchor + no word spacing | Yes | The stream shows a gap of the anchor's width |
| Slot Machine + either grid | Yes | Stable stage order is preserved |
| Slot Machine + explicit Columns | Conditionally | Columns must divide the Slot Machine output count |
| Slot Machine + RandomPositions | No | Progression requires stable reading order |
| Slot Machine + no word spacing | Yes | Stage sequence is preserved in the continuous stream |
| Slot Machine coverage without Slot Machine | No | Coverage has no meaning without a lock order |
| Acrostic target without Acrostic | No | Target has no meaning unless Acrostic is enabled |
| Explicit Columns + RandomPositions | No | Random placement has no grid |
| Explicit Columns + no word spacing | No | The stream has no grid |
| Explicit centered-grid dimensions + other layout | No | Inapplicable setting (§5.2) |
| Explicit random-position dimensions + other layout | No | Inapplicable setting (§5.2) |

## 12. Geometry and fit validation

Fit is verified before output against the configured page geometry using the metrics of the configured font at the configured size. A composition “fits on one page” when this verification succeeds. The page count reported under §16 is the verified count.

An implementation may additionally render the composition, for example to PDF, to confirm that it occupies exactly one page. Any such rendering is an internal verification artifact: it is not a product output, shall not be written to the output destination or beside it, and shall be removed when verification completes. If the implementation depends on such a rendering step and the step fails, the request shall be rejected with an error naming the failed step and the underlying platform error; the document shall not be written unverified.

If the configured font family is not available to the implementation for measurement, the request shall be rejected with an error naming the font. The system must not substitute another font's metrics silently.

Before producing an output artifact, the system shall verify that:

- the outer margins leave positive usable page dimensions;
- the configured row height is at least the natural line height (§3.9) of the configured font and size;
- the available logical width per word can contain the widest `N`-character permutation at the selected font size, measured with the font's metrics;
- the complete grid fits within the usable page area;
- random-position item dimensions fit within the usable page area and can contain the widest permutation; and
- the final composition occupies exactly one page.

If a fit requirement fails, the error shall identify the limiting dimensions and suggest relevant controls to adjust.

## 13. Output and file-safety requirements

### 13.1 Output

The output shall be a single `.docx` document. No other file is delivered to the user. Renderings produced for verification are internal (§12).

### 13.2 Destination handling

- The default file name is `<anchor>-<layout>.docx`, where `<layout>` is `full-page`, `centered-grid`, or `random-positions`. Characters of the anchor that the platform does not permit in file names shall be replaced by `_`. For the default anchor and layout, the default name is `mine-full-page.docx`.
- A destination whose file name does not end in `.docx` shall be rejected; the system shall not append or change the extension.
- A relative destination shall resolve against the caller’s documented current working context.
- The resolved destination shall be available to the user after generation.
- Missing destination directories shall be created. If they cannot be created, generation shall stop with the “output directory cannot be used” error (§14).
- An existing output shall not be replaced unless overwrite permission is explicit.
- If overwrite permission is given but the exact destination is open, locked, or not writable, generation shall stop before replacement.
- Other unrelated documents may remain open; only access to the requested destination matters.

### 13.3 Failure safety

Constraint validation and fit verification shall occur before creating or replacing the document. A failed request shall not silently alter constraints, choose a different destination, omit permutations, duplicate permutations, or produce a knowingly invalid composition. A run either delivers a verified document or delivers nothing; there is no partial success.

## 14. Error-message requirements

Errors shall be specific enough for a user to understand what conflicted and why. A conflict message shall include, when applicable:

1. the relevant setting names and supplied values;
2. the rule each value imposes;
3. why the rules cannot both be satisfied;
4. any calculated value that explains the conflict, such as required anchor index, row count, stage count, or usable dimensions; and
5. one or more concrete corrections.

Validation shall report every conflict that can be detected from the configuration alone, so that a user can correct them in one pass. It may stop at the first conflict that can only be detected during sequence construction or placement, such as an unsatisfiable acrostic or a failed random placement.

File-output errors shall distinguish among at least:

- destination already exists without overwrite permission;
- exact destination is locked or not writable;
- output directory cannot be used;
- destination file name does not end in `.docx`;
- verification rendering failure (§12); and
- document save failure.

The message shall include both the requested and resolved destination when path resolution may be relevant, together with the underlying platform error when available.

## 15. Help and discoverability

An implementation that exposes a command line shall provide a standard help action. Other interfaces shall provide an equivalent discoverable reference.

Help shall:

- list every public setting;
- state defaults and valid ranges or enumerated values;
- explain reading order, the permitted character set, and one-based indexing;
- document incompatibilities and conditional combinations;
- explain X-off and Slot Machine semantics;
- include representative examples; and
- exit without creating or changing an output document.

## 16. Success reporting

After successful generation, the system shall make the following result information available in a form appropriate to its interface:

- resolved output destination;
- page count;
- total and unique permutation counts;
- anchor word, index, and visibility;
- ordering mode;
- Slot Machine lock order, coverage, stage counts, and X-off bands per stage when applicable;
- effective layout, rows, columns, and whether the grid was explicit or automatically selected;
- spacing mode;
- acrostic state and resolved target;
- seed; and
- font family and size.

Implementation-specific diagnostic information may be added, but it is not part of the portable functional contract.

## 17. Acceptance scenarios

### 17.1 Default composition

Given no overrides:

- anchor is `mine`;
- all 24 permutations appear exactly once;
- `mine` appears at index 24;
- the layout is an 8 × 3 full-page grid;
- words have one ordinary space between them;
- rows have no added gap or blank lines;
- typography is Times New Roman, 35 points;
- page size is 595.3 × 841.9 points;
- outer margin is 18 points;
- the output file is `mine-full-page.docx` in the default location; and
- the result is one page.

### 17.2 X-off progression

Given the default anchor `mine` and X-off order `4-3-2-0`:

- the anchor index is determined as 24;
- the first nine items are 4-off;
- the next eight are 3-off;
- the next six are 2-off;
- the final item is the 0-off anchor; and
- order within each band is seed-controlled.

### 17.3 Continuous progression

Given the default anchor `mine`, X-off order `4-3-2-0`, and no-word-spacing mode:

- the sequence follows the same X-off progression;
- all 96 visible characters form one visually uninterrupted stream when the anchor is visible;
- no permutation is split across a line break; and
- wrapping introduces no visible separators.

### 17.4 Default acrostic

Given anchor `mine`, Acrostic enabled, and six columns:

- the result is a 4 × 6 grid;
- row-start characters spell `mine`;
- all 24 permutations are unique; and
- all nonconstrained choices are seed-controlled.

### 17.5 Hidden anchor

Given a valid hidden-anchor request:

- the visible composition contains an anchor-sized blank at the requested position;
- surrounding text does not reflow into that position; and
- the anchor text remains searchable and selectable.

### 17.6 Strict Slot Machine

Given anchor `mine`, lock order `3,2,4`, default coverage, and no explicit column count:

- stage counts are `9,4,1,1`;
- total output count is 15;
- no permutation repeats;
- the anchor is final; and
- the grid is 5 × 3.

### 17.7 All-permutation Slot Machine with X-off ordering

Given anchor `mine`, lock order `3,2,4`, `AllPermutations` coverage, X-off order `4-3-2-0`, and three columns:

- stage counts are `18,4,1,1`;
- all 24 permutations appear exactly once;
- each stage internally follows the available X-off bands in the requested order;
- the anchor is item 24; and
- the grid is 8 × 3.

### 17.8 Random positions

Given an anchor of length `N`, ordinary mode, and RandomPositions layout:

- all `N!` permutations appear once;
- every placement remains inside the usable page area;
- no placement areas overlap;
- the configured minimum gap is maintained; and
- the same seed reproduces the same composition within the implementation.

### 17.9 Nondefault anchor length

Given anchor `cat`, for which `N = 3`:

- ordinary mode contains all `3! = 6` permutations exactly once;
- the default anchor index is 6;
- the X-off bands are `0`, `2`, and `3`, with counts `1`, `3`, and `2` respectively;
- an omitted ordinary-mode column count produces a 2 × 3 grid;
- a Slot Machine lock order contains exactly two unique indices from 1 through 3;
- StrictDerangements Slot Machine stage counts are `2,1,1`, for a total of 4; and
- AllPermutations Slot Machine stage counts are `4,1,1`, for a total of 6.

### 17.10 Centered grid

Given anchor `mine`, `CenteredGrid` layout, and otherwise default settings:

- the grid is 8 × 3;
- the bounded row width is `84 × 3 = 252` points;
- each row's three words are centered within that width with one ordinary space between them;
- the row height is the natural line height of Times New Roman at 35 points;
- the complete grid is centered horizontally and vertically on the page; and
- the output file is `mine-centered-grid.docx` in the default location.

### 17.11 Single-character anchor

Given anchor `a`, for which `N = 1`:

- the composition contains exactly one item, the anchor, at index 1;
- the only X-off band is `0`, and the X-off order `0` is accepted;
- the grid is 1 × 1;
- a Slot Machine lock order is rejected because `N = 1`; and
- Acrostic with the default target constrains the single row to start with `a`, which is satisfied.

### 17.12 Two-character anchor

Given anchor `ab`, for which `N = 2`:

- ordinary mode contains `ab` and `ba`;
- the X-off bands are `0` and `2`, with counts `1` and `1`;
- an omitted ordinary-mode column count produces a 2 × 1 grid, because 3 does not divide 2 and the closest-to-square grid with `rows ≥ columns` is 2 × 1;
- a Slot Machine lock order contains exactly one index, `1` or `2`; and
- both coverage options produce stage counts `1,1`, for a total of 2.

### 17.13 Hidden anchor in a continuous stream

Given anchor `mine`, hidden anchor, and no-word-spacing mode:

- the stream contains 92 visible characters and one gap the width of `mine` at the anchor's sequence position;
- no other permutation moves into the gap; and
- the anchor text remains present for search and selection.

### 17.14 Existing destination

Given the default composition and a destination `poem.docx` that already exists:

- without overwrite permission, the request is rejected, the existing file is byte-for-byte unchanged, and the error names the resolved destination;
- with overwrite permission, the existing file is replaced by the new document;
- with overwrite permission while the file is open or locked by another process, the request is rejected before replacement and the existing file is unchanged; and
- in every case, only `poem.docx` is written; no other file appears in the destination directory.

### 17.15 Anchor with digits and punctuation

Given anchor `a1,-`, for which `N = 4`:

- the four characters are distinct and all permitted;
- all 24 permutations appear exactly once, including `,-a1` and `-,1a`;
- the composition behaves exactly as for `mine`, with an 8 × 3 default grid; and
- the default output file name is `a1__-full-page.docx` on a platform that forbids `,` in file names, or `a1,--full-page.docx` on one that permits it.

### 17.16 Rejected requests

Each of the following shall be rejected before any output file is created or replaced, with an error meeting §14:

- anchor `mine`, X-off order `4-3-2-0`, explicit anchor index 24: the anchor index is inapplicable with an X-off order, even though it equals the determined index; the error states the determined index and the band counts;
- anchor `abcde` with default typography and layout: the error states `N = 5`, 120 permutations, the automatically selected 12 × 10 grid, the usable dimension that the grid exceeds, and corrective options such as a smaller font size or a larger page;
- anchor `mine`, lock order `3,3,4`: repeated position;
- anchor `mine`, lock order `3,2`: wrong number of positions;
- anchor `mine`, Acrostic, six columns, target `xine`: `x` is not an anchor character;
- anchor `mine`, Acrostic, six columns, target `minee`: target longer than the four rows;
- anchor `mine`, lock order `3,2,4`, explicit anchor index 15: anchor index not permitted in Slot Machine mode;
- anchor `mine`, coverage `AllPermutations`, no lock order: inapplicable setting;
- anchor `mine`, `RandomPositions`, explicit columns 3: inapplicable setting;
- anchor `mi ne`: whitespace is not permitted in the anchor;
- anchor `miné`: `é` is not a permitted character; the error names the character and position 4;
- anchor `Mine` with Acrostic target `mine`: `m` is not an anchor character, since matching is case-sensitive;
- destination `poem.txt`: file name does not end in `.docx`; and
- destination that already exists without overwrite permission: the existing file is untouched.
