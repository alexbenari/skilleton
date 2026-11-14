# Update a project to coding-quality v2

Instructions for an agent bringing an existing project's `coding-quality.md` up to v2 of the
skilleton guidelines, while keeping the old version for reference.

## Sources

- v2 (new): https://raw.githubusercontent.com/alexbenari/skilleton/master/coding-quality.md
- v1 (old baseline): https://raw.githubusercontent.com/alexbenari/skilleton/master/coding-quality-v1.md

Fetch both. Strip a leading UTF-8 BOM if present, and compare ignoring line endings.

## Steps

1. **Find the project's guide.** Usually `coding-quality.md` at the repository root. Confirm by
   finding where `CLAUDE.md` / `AGENTS.md` point to the design-guidance document. If there is none,
   stop and report back; do not add one without asking.

2. **Find local changes.** Diff the project's file against skilleton v1, ignoring line endings.
   Each difference is either a project-specific addition (paths, framework rules, local naming) or
   an older or newer copy of the shared text. List the project-specific changes. If you can't tell
   which kind a difference is, ask the user rather than guessing.

3. **Archive the current version.** Copy the project's file, unchanged, to `coding-quality-v1.md`
   next to it. Git records this as a new file, not a rename, because v2 takes over the old path.
   The old version's history stays under `coding-quality.md`.

4. **Install v2.** Write the skilleton v2 text as the new `coding-quality.md`. Keep the project's
   line-ending convention. Then put back each project-specific change from step 2 in the matching
   v2 section. v2 reorganizes some sections:
   - `## Purpose and scope` is now two prose lines instead of bullets.
   - The free-function rule moved: v2 treats free functions in object-oriented code as a design
     smell (`## Core principles`) and dropped v1's "prefer free functions when stateless" line from
     `## Tradeoffs and exceptions`.
   - `## Fine-grained coding guidelines` is new. The performance line moved there from
     `## Tradeoffs and exceptions`.
   - `### Presentation layer` is now `### Presentation/UI layer`.
   - `## Error handling` has new rules on callbacks, non-throwing diagnostics, and not duplicating
     error message strings.
   - `## Test reliability` is the same as in v1.
   - `## Comments` lost the v1 rules on comment length and external references (see step 5).

   If a local change contradicts a v2 rule, keep the v2 rule and report the conflict. Don't merge
   the two silently.

5. **Keep the comment rules.** v2 no longer includes v1's comment rules (comments are rare, at
   most two short sentences, never reference external documents, specs, dates or people). Check
   that `CLAUDE.md` and `AGENTS.md` each have a `## Code comments` section saying this. If one is
   missing, add the section from skilleton's
   https://raw.githubusercontent.com/alexbenari/skilleton/master/CLAUDE.md. v2's `## Comments`
   still lets a doc block hold a "reference to external authority". Report that this contradicts
   the instruction-file rule. Leave the wording as it is unless the user says otherwise.

6. **Check references.** Search the repository for `coding-quality` and for `§ Test reliability`.
   - Links to `coding-quality.md` and its `§ Test reliability` section still work; leave them.
   - Point any link to a v2 file under another name (for example `coding-quality-2.md`) at
     `coding-quality.md`, except in historical specs and plans.
   - Nothing should treat `coding-quality-v1.md` as the active guide.

7. **Verify.**
   - The new `coding-quality.md`, minus the project-specific changes you put back, matches
     skilleton v2 apart from line endings.
   - `coding-quality-v1.md` matches the project's committed version from before this change
     (`git show HEAD:coding-quality.md`), apart from line endings.
   - `git status` shows only the intended files changed.

8. **Commit**, only if the user asked. Use one commit, for example
   "Replace coding-quality.md with v2; keep v1 for reference". List any project-specific changes
   you put back and any conflicts you reported in the commit body.

## Report back

- Which project-specific changes you carried over, and where they went in v2.
- Conflicts between local changes and v2, and differences you couldn't classify.
- Whether you added or changed a `## Code comments` section.
- Every reference you changed.
