# TypeScript Coding Skill Spec

Date: 2026-07-02

## Purpose

Create a standalone `typescript-coding` skill from the current TypeScript
coding standards draft.

This work matters because TypeScript guidance should be available as a reusable
skill without depending on this repository's planning documents or temporary
draft files. The skill should give Codex clear TypeScript-specific guidance
while still respecting explicit user instructions, repository conventions, and
general workflow/design/testing skills.

## Goals

- Create the final skill at `skills/typescript-coding/`.
- Base the skill on
  `skills/tmp-ts-coding/typescript-coding-standards-draft.md`.
- Keep the skill standalone: it must make sense when copied to another skill
  library.
- Preserve the draft's TypeScript-specific guidance while tightening it into a
  concise skill.
- Make the skill explicit about precedence: it should supplement, not replace,
  general coding, design, testing, debugging, and documentation skills.
- Validate the skill using the standard skill validation workflow.

## Non-Goals

- No skill comparison feature in this spec.
- No skill-on-codebase evaluation feature in this spec.
- No skill-manager app changes in this spec.
- No Effect-specific, Cloudflare-specific, or framework-specific TypeScript
  skill in this spec.
- No broad rewrite of existing `.agents/skills`.
- No deletion of temporary source files until the final skill has been reviewed
  and validated.

## Approved Product Direction

The final skill folder will be:

`skills/typescript-coding/`

The skill should be written as a language-specific implementation guide. It
should not try to restate every general software-design principle already owned
by other workflow or design skills.

The final skill should be evaluated after drafting through the separate
skill-on-codebase evaluation process, then compared against existing skills
through the separate skill comparison process. The intended order is:

1. draft the TypeScript skill,
2. run A/B codebase evaluation and revise the skill,
3. run compatibility/comparison reporting and resolve surfaced issues with the
   user case by case.

## Current Input

The draft TypeScript standards currently cover:

- decision priority,
- adaptation to existing codebases,
- expected failures as values,
- parse-don't-validate,
- branded/refined/domain types,
- state machines and boolean blindness,
- deep modules and domain modules,
- application/service modules,
- dependency interfaces and adapters,
- repository and persistence guidance,
- functional core / imperative shell,
- workflow, transaction, and idempotency guidance,
- testing through real seams,
- TypeScript style and safety,
- imports, exports, and file naming,
- JSDoc,
- configuration and resource ownership.

The draft has already had its loose "Handoff / continuation topics" section
removed.

## Skill Design

### Folder structure

The final skill should be created with the official skill initialization script
from the `skill-creator` workflow.

Recommended final structure:

```txt
skills/typescript-coding/
  SKILL.md
  agents/
    openai.yaml
```

Add `references/` only if the final `SKILL.md` would otherwise become too long
or too hard to scan. The first version should prefer one concise `SKILL.md`
unless splitting clearly improves progressive disclosure.

Do not add README, changelog, install guide, or other auxiliary files to the
skill folder.

### Triggering

The `description` frontmatter should trigger when Codex is writing, modifying,
reviewing, or planning TypeScript code.

The description should also make clear that this skill supplements general
coding/design/testing skills rather than replacing them.

### Precedence rules

The skill body must include a short precedence section:

1. Explicit user instructions and repo instructions win.
2. Current project architecture and local conventions win unless they conflict
   with correctness or safety.
3. General workflow/design/testing skills decide the process and broad design
   gates.
4. `typescript-coding` supplies TypeScript-specific implementation guidance.
5. Avoid broad migrations unless the user asked for them.

### Error-value dependency guidance

The final skill should include this rule:

- If the project already has Effect, `better-result`, neverthrow, a local
  `Result`, or another established error-value pattern, use the established
  pattern.
- If there is no established pattern, use a small local `Result` union for the
  current change when that keeps progress moving.
- Recommend adopting a shared result library or shared local prelude when typed
  expected failures become a repeated cross-module pattern.
- Do not stop an unrelated task to redesign the project's error model.
- Treat Effect as an architecture choice, not an incidental dependency.

This rule lets the skill have a point of view without turning every small task
into a tooling adoption decision.

### Required refinements from the draft

The final skill should:

- avoid recommending a new dependency as a mandatory step for a narrow feature,
- keep examples concise and TypeScript-specific,
- keep detailed future topics out of the main body unless they become scoped
  references,
- use imperative/infinitive instruction style per the skill-creator guidance,
- keep the body lean enough to load comfortably with other skills,
- use a softer JSDoc default: exported symbols should have JSDoc when the name
  and TypeScript signature do not fully explain the contract, with a strong bias
  toward documenting exported domain types, parsers, adapters, public services,
  side effects, invariants, and typed-error returns.

## Sign-Off Decisions

- The first version should stay as a single `SKILL.md`, with no `references/`
  folder unless the body becomes too large during drafting.
- The final skill should use the softer JSDoc default described above rather
  than requiring JSDoc for every exported symbol.

## Validation Expectations

Before claiming the skill is ready for evaluation:

- run the standard skill validation script against `skills/typescript-coding/`,
- ensure `agents/openai.yaml` exists and matches the final `SKILL.md`,
- manually review the frontmatter description for trigger clarity,
- manually review that the body does not include temporary planning notes.

The user-visible acceptance behavior is:

Codex can load `skills/typescript-coding/` as a standalone skill for
TypeScript coding tasks, and the skill gives clear TypeScript-specific guidance
without forcing unrelated migrations or dependency decisions.

## Likely Files And Folders

Create:

- `skills/typescript-coding/SKILL.md`
- `skills/typescript-coding/agents/openai.yaml`

Eventually delete after validation and user approval:

- `skills/tmp-ts-coding/typescript-coding-standards-draft.md`
- `skills/tmp-ts-coding/open-issues.md`

## Status

Signed off on 2026-07-02.
