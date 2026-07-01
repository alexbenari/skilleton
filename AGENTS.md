# Repository Instructions

## Planning Flow

Use this flow when the user explicitly wants to plan a new feature together.

1. Get up to speed on the user's feature description by reading the agent documentation in the Agent Documentation section first, then inspecting only the relevant code paths it points to.
2. Refine the spec with the user.
3. Once the spec is agreed, create `docs/specs/[feature-name]-spec.md` and ask the user to sign it off.
4. After spec sign-off, create `docs/plans/[feature-name]-exec-plan.md` using `PLANS.md` as the source of truth, then ask the user to sign it off.
5. Implement the feature after the execution plan is signed off.

If the user explicitly waives part of this flow for the current task, follow the user's instruction.

## Agent Documentation

`docs/agent-docs/` is the canonical agent-facing architecture knowledge base for this repo.

Before planning substantial work, changing architecture, or working in an unfamiliar area:

1. read `docs/agent-docs/agent-architecture-map.md` first,
2. follow its cross-references to only the relevant code and deeper docs,
3. treat its architecture and code-design axioms as normative unless the user approves a challenge.

Historical documents under `docs/specs/` and `docs/plans/` are not the primary source of truth for current architecture orientation. Use them only as historical context when needed.

## Documentation Maintenance

Use the project-local `doc-update` skill when:

1. architecture or code-design changes would make `docs/agent-docs/` stale,
2. infrastructure changes affect how an agent should orient itself,
3. a new substantial feature changes module boundaries, concepts, or assumptions,
4. the user asks to update or maintain the agent knowledge base.

Treat architecture documentation as part of the change, not as optional follow-up work, when the change affects durable structure or assumptions.

If the `doc-update` skill does not exist, notify the user.

## Code design guidance

When working on code design, refactoring, architecture, or code review tasks, first read the repository's design-guidance document `coding-quality.md`, if it exists. Treat that document as the repository's source of truth for local design preferences.

The repository design-guidance document takes precedence over conflicting skill guidance on matters of code structure, layering, naming, responsibility boundaries, and review standards.

Apply that guidance as follows:
- Prefer the repository guidance over general design instincts or conflicting skill preferences.
- If the repository guidance conflicts with framework conventions, correctness, security, explicit user instructions, or hard technical constraints, follow the constraint and explain the deviation briefly.
- Do not apply the repository guidance mechanically; use judgment where the document leaves room for interpretation.

For substantial code changes, design work, or code reviews, perform a final pass against the repository design-guidance document and call out any important deviations, tradeoffs, or unresolved tensions.

## Skill use during planning and execution

When the agent environment provides workflow, design, implementation, testing, or documentation skills, use them according to their triggers. Do not treat an execution plan as an exemption from skill use because the user asked to "execute the plan" rather than explicitly asking to write code. Similarly, do not treat writing a spec as an exemption from skill use because the user did not explicitly ask to design or refactor.

Writing a spec or execution plan requires applicable design skills when the document makes or records design decisions.

Executing an execution plan requires applicable implementation skills when the plan calls for code, tests, refactors, API changes, build changes, documentation changes, or architecture changes. Re-evaluate the plan against the current repository state before editing, then use the skills triggered by the actual work being performed.

Record in the execution plan which skills (or equivalent repository guidance) governed the work. If a skill the repository expects is unavailable, say so and apply the closest repository guidance instead.

## Goal-based verification

Before claiming a feature or fix is complete, identify the user-visible goal or acceptance behavior in one sentence.

Verification must prove that goal, not just prove that code changed or tests pass.

Use automated verification when unit, integration, or e2e tests can directly prove the goal. If the goal involves perceived UX, real app behavior, performance, media playback, layout, or other behavior not fully covered by tests, perform targeted manual QA in the actual app and report what was verified.

Do not claim completion from implementation-level evidence when the requested goal is user-visible behavior.

## Shell/Text Extraction

When extracting or matching prose from external sources in shell commands, avoid
embedding long exact strings with smart punctuation, non-ASCII typography, or
copied whitespace directly into shell string literals. Prefer stable ASCII
anchors, structural selectors, wildcard fragments, regexes, or source-loaded
comparison strings that match the minimum needed text.
