---
name: hebrew-sentence-extraction
description: Extract clean Hebrew prose sentences from an HTML file (e.g. a saved Wikipedia article, or any page saved as .html/.htm/.mhtml) into a CSV with one sentence per row, markup stripped and sentences that mix Hebrew with English dropped. Use this whenever the user uploads or references an HTML file and asks to pull out the Hebrew text as sentences, one per line/row, for a CSV or spreadsheet — including phrasing like "extract the Hebrew text", "turn this article into a list of sentences", "give me one row per sentence", or "I need this Hebrew page as a sentence dataset". Currently HTML input only (not yet PDF/docx/plain text) — if the user has a non-HTML source, mention that this skill currently only handles HTML.
---

# Hebrew Sentence Extraction

Turn an HTML page into a CSV of clean Hebrew sentences — one sentence per
row, no HTML tags, no boilerplate, and no sentences that mix Hebrew with
English (a common annoyance in Wikipedia articles, which are full of
inline English product names, model numbers, and citations).

This was built and validated against real Hebrew Wikipedia articles, which
have a specific set of quirks (inline wikilinks glued to punctuation,
gershayim abbreviations, footnote markers, see-also/external-link
sections) that a naive "strip tags and split on periods" approach gets
wrong in ways that are easy to miss on casual inspection. Use the bundled
script rather than reimplementing this from scratch — the fixes below
came from debugging actual mis-splits and mis-joins on real articles, and
they are not obvious until you hit them.

## How to run it

```bash
pip install beautifulsoup4 lxml --break-system-packages  # if not already installed
python3 scripts/extract_sentences.py <input.html> <output.csv>
```

For non-Wikipedia HTML (a news article, a blog post, a generic saved
page), disable the Wikipedia-specific "stop at see-also" behavior and,
if needed, point at the right content container:

```bash
python3 scripts/extract_sentences.py page.html out.csv --no-wiki-stop --content-selector "article"
```

If `--content-selector` is omitted, the script tries `div#mw-content-text`
(Wikipedia) first, then falls back to `main`, `article`, `#content`,
`#main`, and finally the whole `<body>`.

Then deliver `out.csv` to the user. Skim the first ~20 rows before
sending — if the source page has an unusual structure (e.g. content is in
`<div>`s instead of `<p>`/`<li>`, or there's a content container the
auto-detection missed), you may need to adjust `--content-selector` or,
for a genuinely unusual layout, edit the script's `collect_blocks()` to
also pull from `<div>` blocks. Don't silently ship an empty or near-empty
CSV — if the row count looks too low for the size of the source page,
investigate before sending.

## Why the script is written this way (read before modifying)

If you find yourself wanting to write a quicker version of this inline
instead of using the script, don't — every one of these choices exists
because the naive version silently produced wrong output on a real
article. They're subtle enough that they won't show up unless you check
specific sentences carefully.

**Getting text out of the HTML.** Use
`element.get_text(separator='', strip=False)` and normalize whitespace
*afterward* with a regex, not BeautifulSoup's `strip=True`. The reason:
`strip=True` strips whitespace from each text node individually, before
joining — regardless of what separator you pass. On real wiki markup this
breaks in two opposite directions at once. A phrase like `חברת <a>קאדילק</a>`
has a real space in the "חברת " text node right before the link; `strip=True`
eats that trailing space, so the two words get glued into "חברתקאדילק".
Meanwhile `<a>מוסך</a>.` has *no* space between the link and the following
period in the source; using `separator=' '` inserts one anyway, producing
"מוסך ." with a floating period. Keeping `strip=False` and `separator=''`,
then collapsing whitespace runs afterward, reproduces the source spacing
exactly instead of guessing at tag boundaries.

**Where prose stops.** Wikipedia articles end their real content at
a "ראו גם" (see also), "קישורים חיצוניים" (external links), or "הערות
שוליים" (footnotes) heading. Everything after that is link titles and
citation metadata — Hebrew text, technically, but not sentences anyone
wants in a sentence dataset. The script stops collecting `<p>`/`<li>`
blocks once it hits one of those headings. This is Wikipedia-specific,
so it's the first thing to disable (`--no-wiki-stop`) on other kinds of
pages.

**Sentence boundaries vs. abbreviation periods.** Splitting on
`(?<=[.!?])\s+` works for most sentences, but Hebrew text has two common
period patterns that aren't sentence ends:

- Multi-part abbreviations like "וושינגטון די. סי." (Washington D.C.) —
  a short token's period followed immediately by another short token's
  period.
- Initials inside names, like "ג'ואן ק. קרל", where "ק." is a middle
  initial, not the end of a thought.

Both get protected with a placeholder character before splitting, then
restored afterward. The tricky part is *not* protecting the wrong thing:
Hebrew measurement abbreviations that use a gershayim (the "׳/״"-like
quote character), such as ס"מ (cm), ק"ג (kg), מ"מ (mm), ק"מ (km), are
internally three characters — letter, gershayim, letter — and a plain
regex word-boundary (`\b`) fires right after the internal gershayim,
making the trailing letter look like a standalone one-letter word. That
falsely matches the "initial" pattern and merges a real sentence boundary
like "...20 ס"מ." with the next sentence. The fix used here requires the
short token to be preceded by whitespace or the start of the string, not
just a `\b` boundary — that's the difference between a genuine standalone
word and the tail end of a gershayim abbreviation. If you extend the
abbreviation list, keep this whitespace-anchored-lookbehind approach
rather than switching back to plain `\b`.

**Filtering mixed-language sentences.** After splitting, a sentence
survives only if it contains at least one Hebrew character and *no*
Latin letters at all. This intentionally drops sentences that mix Hebrew
and English (extremely common in Wikipedia — inline English product
names, citation titles, foreign terms in parentheses) as well as any
purely English sentences, since the goal is a clean Hebrew-only dataset.
If a user specifically wants mixed-language sentences kept, that's a
one-line change to `filter_sentences()` in the script — don't just
patch around it by hand-editing the CSV afterward.

**Dedup.** Duplicate sentences (repeated boilerplate, or the same
short phrase appearing twice) are dropped, keeping first-occurrence
order — the goal is a dataset of unique sentences, not a full-text dump.

## Output format

A UTF-8 CSV (written with `utf-8-sig` so Excel/Sheets render Hebrew and
RTL correctly) with a single header `sentence` and one sentence per row,
in document order.

## Scope

HTML input only, for now. If the user's source is a PDF, Word doc, or
plain text file, say so plainly rather than guessing — this skill's
approach (DOM-aware block extraction, tag-boundary-safe text extraction)
is specific to HTML, and stretching it to other formats without adapting
the extraction step would silently produce worse results. If it comes up,
mention that the skill could be extended to those formats but currently
isn't.
