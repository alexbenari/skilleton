# Execution Plans (ExecPlans):

This document defines the requirements for an execution plan ("ExecPlan"), a self-contained design and implementation spec that an agent can execute to deliver a working feature or system change. Assume the reader has only the current repository snapshot and the single ExecPlan file you provide. There is no memory of previous plans or external context.

## How to use ExecPlans and PLANS.md

When writing an ExecPlan, follow PLANS.md exactly. If you do not know it by heart, read the entire file before drafting your plan. Start with the skeleton and expand it as you research.

When writing an ExecPlan, use applicable workflow and design skills before the plan records design decisions. Record the relevant skills or equivalent guidance in the plan's `Skill Gates` section.

When executing an ExecPlan, do not ask the user for "next steps." Proceed to the next milestone. Keep all sections current, split or add steps at each stopping point, and record what changed and why.

When executing an ExecPlan, treat each implementation step as triggering the same skills it would trigger if requested directly; apply them before the work is performed. Keep the `Skill Gates`, `Progress`, and `Decision Log` sections current as skills are used and decisions change.

When discussing an ExecPlan, keep decisions in the plan so someone can restart from the document alone.

When researching, include prototypes, spikes, and experiments that reduce risk.

## Requirements

NON-NEGOTIABLE REQUIREMENTS:

* Every ExecPlan MUST be fully self-contained. It MUST include all context and instructions needed for a novice to succeed.
* Every ExecPlan MUST be a living document. Update it as progress happens, as discoveries are made, and as decisions change.
* Every ExecPlan MUST enable observable outcomes, not just code edits.
* Every ExecPlan MUST define any specialized term in plain language or avoid it.

Start with a short explanation of why the work matters to users, then specify exact edits, commands, and expected outcomes.

The executing agent can list/read files, search, run the project, and run tests. Do not assume prior context. Repeat assumptions explicitly.

## Formatting

An ExecPlan should be one Markdown file. If the plan is inside another Markdown file, use a single fenced code block labeled `md`. Do not use nested triple-backtick fences; use indented blocks for commands, logs, or examples.

Use clear headings, short paragraphs, and checklists only where required.

## Guidelines

Self-containment and clarity:

* Define any non-obvious term immediately and point to where it appears in this repo.
* Do not say "as discussed above" or rely on external context.
* Include concrete file paths (for example, `src/server/api.ts`).

Implementation details and observability:

* Describe exact functions/modules to change and how behavior changes.
* Include commands to run and what success looks like.
* Add negative-case checks where relevant.

## Milestones

Milestones must be concrete and independently verifiable. For each milestone, include:

* Scope: what capability is added in this step.
* Changes: exact files to modify/create and the code-level description of each change.
* Validation: commands/tests and expected results.
* Rollback/Containment: how to recover if the step fails.

## Living plan sections (mandatory)

Every ExecPlan must maintain these sections:

1. `Progress`
2. `Skill Gates`
3. `Surprises & Discoveries`
4. `Decision Log`
5. `Outcomes & Retrospective`

Update these sections during execution, not after.

## Skill Gates

Every ExecPlan must include a `Skill Gates` section that lists which skills or equivalent guidance apply while writing and executing the plan.

The section must cover both planning-time and execution-time work:

* Planning gates: skills or guidance used before the plan records design decisions such as architecture, module boundaries, public interfaces, state ownership, refactoring strategy, test strategy, build or dependency changes, observability, error handling, security boundaries, frontend behavior, or documentation updates.
* Execution gates: skills or guidance required before implementation, tests, refactors, API changes, build changes, documentation updates, architecture changes, or completion review.
* Availability: any expected skill that is unavailable in the current environment, plus the fallback guidance used instead.

Update this section when the plan changes scope or discovers new work that triggers additional skills.

## Prototypes and parallel implementations

When uncertainty is high, add prototype milestones before production edits. For each prototype:

* Hypothesis being tested.
* How to run it.
* Pass/fail signal.
* What decision it informs.

If running multiple approaches in parallel, define selection criteria and record the final choice in `Decision Log`.

## Skeleton of a good ExecPlan

```md
# <Brief, action-oriented title>

## Why this matters

Describe the user-visible capability and why it is needed.

## Progress

- [ ] (YYYY-MM-DD HH:MMZ) <Concrete deliverable>
- [ ] <...>
- [x] (YYYY-MM-DD HH:MMZ) <Completed item>

## Skill Gates

Planning-time gates:

- <Skill or guidance>: <why it applies while drafting this plan>

Execution-time gates:

- <Skill or guidance>: <when it must be used during implementation>

Unavailable skills or fallbacks:

- <Skill or guidance>: <fallback, or "none">

## Surprises & Discoveries

- Discovery: <fact>
  Evidence: <command output, test result, or file reference>

## Decision Log

- Decision: <what was decided>
  Rationale: <why>
  Date/Author: <YYYY-MM-DD> / <name>

## Outcomes & Retrospective

Summarize shipped behavior, evidence, and follow-up work.

## Context and orientation

Describe the existing system for a newcomer. Name key files and data flow.

## Milestone 1 - <name>

### Scope

<What this milestone delivers>

### Changes

- File: `<path>`
  Edit: <specific code change>

### Validation

- Command: `<exact command>`
  Expected: `<observable result>`

### Rollback/Containment

<How to safely revert or isolate this milestone>

## Milestone 2 - <name>

### Scope

<...>

### Changes

- File: `<path>`
  Edit: <...>

### Validation

- Command: `<exact command>`
  Expected: `<...>`

### Rollback/Containment

<...>
```
