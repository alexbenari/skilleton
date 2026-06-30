---
name: bugfix-by-failing-test
description: Use when fixing a bug or issue with a test-first workflow by writing a failing test, confirming the failure, implementing the minimal fix, and proving the test passes.
---

# Bugfix By Failing Test

Use this workflow to fix defects with proof. Always establish a failing test first, then implement the smallest safe fix, then verify the test passes.

## Workflow

1. Define the bug behavior in one sentence.
2. Locate the narrowest test target that can express the bug.
3. Add a test that should fail because of the bug.
4. Run the smallest test command that executes that test.
5. Confirm the test fails for the expected reason.
6. Implement the minimal code change to fix the bug.
7. Re-run the same test and confirm it passes.
8. Run the entire test suite (or relevant subset) to ensure no regressions.
9. Report evidence: failing output before, passing output after, and files changed.

## Guardrails

- Do not ship a bug fix without a reproducing test, unless the codebase has no runnable test stack.
- Keep the first failing test focused on a single behavior.
- Prefer existing test conventions, fixtures, and helpers in the repository.
- Avoid broad refactors during the fix; keep scope tied to the failing behavior. If a refactor is needed, ask for confirmation and consider doing it in a separate PR after the bug is fixed.
- If the test cannot be made deterministic, explain why and propose the closest deterministic assertion.

## Test Selection Heuristics

- Use unit tests for pure logic bugs.
- Use integration tests when the bug depends on component interaction.
- Use end-to-end tests only when the behavior cannot be validated lower in the stack.
- Start with the narrowest layer that can reproduce the defect reliably.

## Completion Criteria

Consider the bug fix complete only when all are true:

- A new or updated test reproduces the original bug.
- The test was observed failing before the code change.
- The same test passes after the code change.
- Related checks (the entire test suite or relevant subset, lint/build if applicable) pass.
- Final summary clearly links bug -> test -> fix -> verification.
