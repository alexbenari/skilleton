---
name: cost-aware-delegation
description: Use when considering or performing Codex subagent delegation in this project; applies a cost-first eligibility gate, chooses the least expensive suitable model, and defines bounded briefs, evidence, ownership, and verification.
---

# Cost-Aware Delegation

Use delegation to substitute a less expensive model for work that would otherwise
consume the strong root model. Do not delegate merely to create parallel activity.
Subagents add briefing, context, coordination, and verification cost.

## Keep with the root

The root retains:

- architecture and cross-cutting design;
- ambiguous, tightly coupled, or judgment-heavy coding;
- research synthesis, tradeoff analysis, and decisions;
- requirements, user interaction, scope, and authorization;
- integration and final acceptance.

Small mechanical edits normally stay with the root because spawning and checking
an agent can cost more than making the edit in the existing context.

## Delegation eligibility

Delegate only when every condition holds:

1. A less expensive available model is expected to perform the task with
   reliability comparable to the root model.
2. The task contains enough substantive work to amortize preparing the brief,
   supplying context, coordinating the run, and verifying the result under the
   conservative estimate below.
3. The outcome, scope, acceptance criteria, and stopping point can be stated
   precisely.
4. The result has an independent verification channel that is materially cheaper
   than performing the task directly.
5. The task can be completed within the user's existing authorization and, for
   writes, within an exclusive file scope that does not overlap another agent.

If any condition fails, keep the work with the root or first split it into a
larger independently useful and verifiable work packet. Do not fragment work into
tiny delegated steps.

## Model and effort selection

Choose the least expensive model and lowest reasoning effort likely to meet the
brief. Judge the task itself rather than the role name.

- Use low effort for deterministic commands, inventories, straightforward
  extraction, and other mechanically checkable work.
- Use medium effort for bounded research, codebase mapping, and clear multi-step
  work.
- Escalate only when the task actually requires deeper inference, difficult edge
  cases, or broad integration judgment. If it requires root-level judgment, keep
  it with the root instead of delegating by default.

Do not assume a built-in agent such as `explorer` is inexpensive. Unless its
model and effort are configured or supplied explicitly, it can inherit the
parent's settings. Select model and effort explicitly when the savings matter.

## Conservative cost estimate

Do not retrieve current token rates for every delegation decision. For routine
decisions, use the relative cost tiers already known in the session or
configuration. Consult current rates only when a model or tier is unknown, the
candidate task is large or borderline, or the policy is being deliberately
recalibrated. Small rate changes should not reverse an ordinary decision.

Compare plausible ranges rather than pretending to know exact token use:

```text
direct cost = root execution
delegated cost = root briefing and context + subagent execution and report
               + root verification and synthesis + failure/recovery allowance
```

Count duplicated context, tool work, retries, and expected output—not only the
nominal model rate. Delegate only when the plausible upper bound of delegated
cost is comfortably below the plausible lower bound of direct cost. As a
practical default, `delegated upper bound <= 70% of direct lower bound` is a
clear advantage; treat the threshold as a conservative heuristic, not a precise
accounting result. If the ranges overlap or cannot be estimated with confidence,
keep the work with the root.

## Brief contract

Every delegation brief must include:

- the concrete outcome and requested deliverable;
- only the context needed to do the task;
- explicit read scope and, if applicable, exclusive write paths;
- acceptance criteria and a stopping condition;
- the independent check the root plans to perform;
- evidence the agent must return, including exact artifact paths, commands and
  results, source links or code locations, and relevant counts or hashes;
- an instruction to report missing context, uncertainty, and disagreements with
  the specification or oracle instead of guessing or tuning to match it;
- a concise output budget;
- explicit exclusions for unrelated edits, commits, pushes, pull requests,
  external messages, destructive actions, or other unrequested side effects.

For shared-workspace writes, state which files belong exclusively to the agent
and which files remain root-owned. Preserve pre-existing user changes. Never ask
an agent to stash, reset, discard, or absorb unrelated work.

## Return contract

Require this compact final report:

```markdown
## Result
- status: success | partial | blocked
- deliverable: <path, commit, structured result, or none>
- scope completed: <concise bullets>
- verification run: <exact commands/checks and observed results>
- evidence for root check: <paths, references, counts, hashes, or source links>
- deviations or disagreements: <none or details>
- remaining issues: <none or details>
- root action needed: <none or one concrete action>
```

A completion notification without the deliverable and evidence is incomplete.
Request the missing report or inspect the persisted artifacts; do not infer
success from silence or a one-word status.

## Root verification

Verify load-bearing claims through the predefined cheapest direct channel, such
as a targeted test, a focused diff inspection, a count, a hash, a source check,
or direct observation of the requested behavior. Self-attestation and a second
agent's agreement are not independent proof by themselves.

If adequate verification would require repeating most of the delegated task,
stop treating the result as verified. The work packet failed the eligibility
test; keep that class of task with the root or redesign its acceptance evidence
before delegating it again.

Use a separate reviewer only when consequence and residual uncertainty justify
its additional cost. Review does not automatically require the strongest model;
use the least expensive model capable of evaluating the particular risks. Keep
architectural and other judgment-heavy review with the root.

## Lightweight diagnostics

Keep a compact in-session record for each actual delegation:

```text
task class: <mechanical | repository discovery | bounded research | other>
root -> subagent: <models and efforts>
expected advantage: <clear | borderline>
outcome: <success | partial | blocked>
root rework: <none | small | substantial>
verification: <cheap | moderate | task effectively repeated>
verdict: <good delegation | false economy | inconclusive>
```

For a borderline candidate retained by the root, record only the decisive reason
when it would help later calibration; do not log routine non-delegation choices.
At the end of a task in which delegation occurred, report the number and outcomes
of delegations, any false economies, and any briefing, context, or verification
cost that was underestimated. Suggest at most one policy adjustment, and only
when repeated evidence supports it rather than a single result.

Keep these diagnostics in the task context by default. Do not create or update a
persistent log unless the user or repository policy requests one. Prefer observed
rework, retries, and verification effort over invented token counts when reliable
per-agent usage is unavailable.

## Concurrent work

Parallelism is not an independent reason to delegate. If the user explicitly
requests concurrent work or multiple already-eligible tasks happen to run
together, give every writing agent disjoint ownership and serialize overlapping
files, shared manifests, generated identifiers, exclusive tools, and final
integration.
