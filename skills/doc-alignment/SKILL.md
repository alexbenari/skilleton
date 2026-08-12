---
name: doc-alignment
description: Audit all living documentation against the actual state of the repository, then fix confirmed drift. EXPLICIT INVOCATION ONLY — use when the user explicitly asks for a doc alignment / audit / staleness-review pass (or /doc-alignment). It fans out verification agents over every in-scope document and is expensive; never self-trigger. Staleness noticed incidentally during other work goes through doc-update or gets flagged to the user instead.
---

# Doc Alignment

A whole-surface audit, run only on explicit request: extract the checkable claims the living
documentation makes, verify each against the repository's actual state, fix what is confirmed
wrong, and report what needs an owner's judgment.

Complementary to `doc-update`, which maintains `docs/agent-docs/` incrementally as part of a
change. This skill is the periodic sweep that catches what change-driven maintenance missed;
apply `doc-update`'s editing rules and governance to every fix it produces.

## Scope contract

**In scope — living documents** (they claim to describe the present):

1. the agent knowledge base (`docs/agent-docs/`: maps and deeper docs),
2. READMEs and setup docs,
3. root instruction files — `CLAUDE.md` / `AGENTS.md`; where they are meant to be identical
   twins, diff them and decide sync direction from git history,
4. task registers and open-question docs (open-tasks lists, bug registers),
5. code comments and doc-bearing output strings, where they make claims about current behavior.

**Out of scope — historical records** (they describe what was true then; never rewrite):

- `docs/specs/`, `docs/plans/`, handoff documents, timestamped run outputs and their summaries,
  session analyses. At most flag a dangerously misleading one to the user.
- When a living doc cites a historical record for *current* guidance and the guidance has
  expired, fix the living doc's citation — not the record.

State the assumed in/out split to the user before verifying; they may adjust it.

## Method

1. **Inventory first.** Glob the full doc surface and group it before reading anything deeply.
2. **Fan out report-only verification agents**, one per document group, in parallel. Each brief
   must instruct the agent to: check every referenced path exists (naming what exists nearby if
   not); read every `file:line` citation and report drift with the current location; recompute
   counts; verify version pins, dates and branch claims via git; hunt contradictions inside each
   doc and across docs; and **report disagreements without deciding which side is right — never
   edit**.
3. **Verify before editing.** Independently confirm each load-bearing agent claim through the
   cheapest direct channel (grep, count, `git log`) before changing a doc. Agent reports mix
   true positives with miscounts.
4. **Fix under `doc-update`'s editing rules** (smallest surface, descriptive vs normative,
   verify links you add), and bump each touched doc's freshness metadata with a dated
   "doc-alignment pass" note saying what changed.
5. **Report in two lists**: *fixed* (with the evidence) and *flagged for owner* — domain
   judgments, out-of-scope files, and any doc-vs-artifact disagreement only the owner can settle.

## What rots fastest — check these hardest

In observed order of decay:

1. **Negative / absence claims** — "none found", "nothing references X", "not present",
   "not yet written". They expire silently when the world grows (a dependency vendored in, a
   sibling repo cloned, a doc finally written); expect near-total rot.
2. Consumer / dependency / version-pin tables.
3. `file:line` references — code moved; report the new line rather than deleting the reference.
4. Counts ("N files", "N tests", "N columns").
5. Dates and branch tips.
6. Artifact and file names after a rename campaign.
7. "Open questions" whose answer now exists in the repository.

## Fix conventions

1. A resolved open question keeps its history: strike it through and state the resolution
   beside it rather than deleting it.
2. A corrected claim carries its evidence (path, count, commit) so the next audit re-verifies
   cheaply.
3. Leave approximations alone when they are within their stated tolerance — and recount before
   "correcting": independent counts can disagree with each other and match the doc.
4. Historical measurements quoted inside living docs ("measured on X, 2026-08-06") get an
   annotation when the surrounding facts changed — never a rewritten number.
5. Code comments state constraints self-contained; do not cite spec/doc names in them, and drop
   such citations when touching a line anyway.
