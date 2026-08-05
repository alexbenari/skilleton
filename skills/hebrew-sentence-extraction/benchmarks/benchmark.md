# hebrew-sentence-extraction — Benchmark (Iteration 1)

Two evals, one run per configuration (`with_skill` vs. `without_skill`, i.e. an
agent solving the task from scratch with no access to this skill).

| Eval | Config | Pass rate | Time (s) | Tokens |
|---|---|---|---|---|
| Wikipedia presidential car | with_skill | 8/8 (1.00) | 46.5 | 34,547 |
| Wikipedia presidential car | without_skill | 7/8 (0.88) | 462.1 | 102,348 |
| Non-Wikipedia news article | with_skill | 7/7 (1.00) | 71.5 | 34,534 |
| Non-Wikipedia news article | without_skill | 7/7 (1.00) | 138.9 | 43,088 |

**Aggregate (mean across both evals):**

| Config | Pass rate | Time (s) | Tokens |
|---|---|---|---|
| with_skill | 1.00 | 59.0 | 34,541 |
| without_skill | 0.94 | 300.5 | 72,718 |
| **delta** | **+0.06** | **-241.5** | **-38,178** |

## What the evals check

**Eval 1 — Wikipedia presidential car** (`evals/files/wikipedia_presidential_car.html`,
the Hebrew Wikipedia article on "The Beast"): validates against a hand-verified
reference extraction of 96 sentences. Checks row count, absence of Latin
characters/HTML tags/footnote markers, absence of See-also/External-links
citation lines, correct handling of the "וושינגטון די. סי." (Washington D.C.)
multi-part abbreviation, and correct sentence-ending on gershayim measurement
abbreviations like ס"מ./ק"ג.

**Eval 2 — Non-Wikipedia news article** (`evals/files/sample_article.html`, a
synthetic article I wrote specifically to exercise edge cases): validates
correct exclusion of nav/footer/sidebar boilerplate (this page uses `<article>`
+ `<aside>` + `<footer>`, not Wikipedia's structure), correct dropping of
sentences mixing Hebrew and English (`Tesla Model 3`, `BYD Atto 3`), and the
same abbreviation/initial edge cases as eval 1 at smaller scale.

## Notes from the analyst pass

- Eval 1 is where the skill's value shows most clearly: the `without_skill`
  run missed the exact spacing in the Washington D.C. abbreviation (produced
  `די.סי.` with no space instead of `די. סי.`) — a minor fidelity slip an
  ad-hoc reimplementation is prone to.
- **Both** configurations avoided the more serious bug found while developing
  this skill: an earlier version of the bundled script had an overly-loose
  "protect 1-2 letter initials before a period" heuristic that silently
  merged real sentence boundaries ending in common two-letter Hebrew words
  like `עת` ("time"). It was caught during this benchmark run (the
  `with_skill` output was regenerated after the fix) and the script now only
  protects single-letter initials. The `without_skill` agents happened to
  avoid this pitfall on their own, but that's not guaranteed on a future
  run — the fix is baked into the script, so re-running the skill will
  always get it right, whereas an ad-hoc rewrite has to rediscover it each
  time.
- Eval 2 is small enough that both configurations scored perfectly — its
  purpose is regression-testing specific edge cases (the `--no-wiki-stop`
  path, gershayim abbreviations, mixed-language filtering) rather than
  differentiating skill value.
- `with_skill` used roughly 2-3x fewer tokens and 2-6x less wall-clock time
  than `without_skill`, because the agent read `SKILL.md` and ran the
  bundled script directly instead of re-deriving the extraction logic (and
  its edge-case fixes) from scratch each time.

## Reproducing / extending this benchmark

- `benchmark.json` — machine-readable results in the skill-creator schema
  (see `references/schemas.md` in the skill-creator skill for the field
  definitions), viewable via `eval-viewer/generate_review.py`.
- `iteration-1-review.html` — a static snapshot of the side-by-side output
  review (prompt, output, grading) for both evals, both configurations.
- `../evals/evals.json` — the eval definitions (prompts + expectations) used
  to produce this run. Re-run these (with a fresh `with_skill` /
  `without_skill` pair) after future changes to `scripts/extract_sentences.py`
  to check for regressions before shipping.
