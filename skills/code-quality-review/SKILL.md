---
name: code-quality-review
description: Review a finished code change against the repository's design-guidance document (coding-quality.md) with a fresh-context reviewer, then fix what has one correct resolution. Checks design and code quality, not correctness bugs. Use after every non-trivial code change, before reporting it done or committing it, at the end of each execution-plan milestone that changes production code, or when the user asks for a code quality review.
---

# Code Quality Review

The review standard is the repository's design-guidance document,
`coding-quality.md`, together with any guidance document it delegates a kind of
code to, such as UI guidelines. This skill defines how to review against them;
it adds no rules of its own. If `coding-quality.md` does not exist, skip the
review and say so.

## When to run

Run once per logical change, after it builds and its tests pass, and before
reporting it done or committing it. In an execution plan, run it at the end of
each milestone that changes production code, before the milestone's validation
gate, so the gate also covers the review's fixes.

A change is non-trivial when it creates, splits, merges, moves, or redefines a
responsibility. That includes a change that:

- adds a class, module, or production source file;
- changes a signature or public interface that has callers;
- moves code between classes, files, or layers;
- replaces an algorithm or rewrites a function's control flow;
- adds a feature.

Skip test-only, documentation, configuration, and formatting changes,
mechanical renames, and a localized fix inside one function that leaves its
signature unchanged. If unsure, about 50 or more changed production lines across
two or more files means run. When still unsure, run.

## Workflow

1. Collect the review input:
   - the change: the base commit it started from, so the reviewer can read
     `git diff <base>` (uncommitted work plus the change's commits);
   - the touched production and test files;
   - one paragraph on what the change is for. State the goal, not the design
     rationale: the reviewer judges the code as a new reader would;
   - the path of `coding-quality.md`, of each guidance document it delegates
     touched code to, and of `docs/agent-docs/agent-architecture-map.md` if it
     exists.
2. Start a reviewer with a fresh context and give it
   [reviewer-brief.md](reviewer-brief.md) filled in with that input. A fresh
   context means the reviewer receives only the brief, not this conversation:
   - Claude Code: the `Agent` tool with a general-purpose subagent, not a fork.
   - Codex: `spawn_agent` with `fork_turns` set to `"none"`.
   - Give the reviewer the same model and reasoning effort as this session. In
     Codex, pass `model` and `reasoning_effort` explicitly, because an isolated
     spawn otherwise falls back to the configured subagent default. Review is a
     judgment task; do not downgrade it.
   - If no subagent can be started, follow the brief yourself and say in the
     report that the review was not independent.
3. Wait for the reviewer's report. It does not edit files.
4. Triage every finding:
   - Fix it when it has one correct resolution consistent with the agreed
     design, for example an unused parameter, a field named by its type instead
     of what it holds, or a duplicated error message.
   - List it for a decision when resolving it means choosing between designs,
     moving a class or layer boundary, adding or removing an abstraction,
     changing behavior, or departing from a signed-off spec or plan.
   - Decline it only when it is wrong, with a one-line reason. Inconvenience is
     not a reason.
5. Re-run the builds and tests that cover the fixed code. If a fix itself moved
   a responsibility, review the fix again.
6. Report.

## Report

Keep the report short:

- Fixed: one line per fix.
- Needs your decision: the question, the options, and a recommendation.
- Declined: the finding and why it is wrong.
- Clean: the areas the reviewer found nothing in.
- Reviewer: fresh context, or inline with the reason.

Include the report in the completion report. In an execution plan, record it in
the milestone's `Progress` entry and put open decisions in the `Decision Log`
once they are made.
