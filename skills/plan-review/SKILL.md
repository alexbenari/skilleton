---
name: plan-review
description: Review a feature spec or execution plan for contradictions, holes, leftovers from earlier versions, gate ordering, readability, and execution token savings, then fix what has one correct resolution. Use before asking the user to sign off a spec or plan, after any substantial revision of one, or when the user asks to review a spec or plan.
---

# Plan Review

Review one spec (`docs/specs/*-spec.md`) or execution plan
(`docs/plans/*-exec-plan.md`). If no path is given, review the spec or plan
currently being drafted.

The document rules being checked are defined in `PLANS.md` ("Writing for the
reader" and "Milestones"). They apply to specs as well as plans, except gate
ordering, which applies only where there are milestones.

## Workflow

1. Read the whole document. When reviewing a plan, also read its signed-off
   spec if one exists.
2. Read code only to verify a specific claim the document makes. Do not
   re-derive the design.
3. Run every check below.
4. Fix each issue that has one correct resolution consistent with the agreed
   decisions.
5. Do not resolve issues that need a decision: a choice between behaviors, a
   scope change, a conflict between two agreed decisions, or a plan that
   diverges from its signed-off spec. List them instead.
6. Re-read the sections you changed to confirm the fixes did not introduce new
   contradictions or leftovers.
7. Report.

## Checks

1. Contradictions: decisions that conflict with each other, with milestone
   content, with validation gates, or with the signed-off spec.
2. Holes: undefined or underdefined cases. Look at inputs and boundaries,
   states and transitions, failures and recovery, ordering and concurrency,
   persistence and restart, and what the user sees in each case.
3. Leftovers from previous design decisions or document versions: references
   to rejected designs, removed milestones, renamed concepts, or stale IDs.
   Rejected designs appear only in `## Rejected alternatives`, one line each.
   A superseded decision must not remain in the decisions table.
4. Gate ordering (plans only): every milestone validation gate uses only
   capabilities delivered by its own milestone or an earlier one.
5. Readability: the user can understand the document quickly. No compressed
   internal shorthand, no undefined terms, and no sentence that needs the
   codebase open to parse. Code identifiers appear as references beside a
   plain description, not as the description.
6. Token-use optimizations: Any changes that can be applied to decrease the tokens spent executing
   the plan while achieving the same goal. Examples: reusing fixtures, probes,
   and result formats, not repeating measurements unnecessarily, narrower commands during iteration while keeping the full run at the gate. Longer execution time is acceptable as a tradeoff. Never compromise
   correctness, test coverage, or code quality.

## Report

Keep the report short:

- Fixed: one line per fix.
- Needs your decision: the question, the options, and a recommendation.
- Clean: the checks that found nothing.

When the review runs as part of a sign-off request, include the report in that
request.
