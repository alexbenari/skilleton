---
name: doc-update
description: Maintain docs/agent-docs as the canonical agent-facing architecture knowledge base. Use when architecture, code-design, substantial feature, or infrastructure changes affect agent orientation, or when updating, pruning, or obsoleting agent docs.
---

# Doc Update

Use this skill for repo-local maintenance of `docs/agent-docs/`.

This skill is about durable orientation docs, not routine release-note churn.

## What the knowledge base is for

The knowledge base exists so a future agent can:

1. understand what the app is for,
2. understand the architecture and code-design axioms that should be preserved,
3. know where to look without reading the entire codebase,
4. load only the minimum useful context before planning work.

The canonical entrypoint is `docs/agent-docs/agent-architecture-map.md`.

## Update threshold

Update `agent-architecture-map.md` when durable structure changes.

Update it for:

1. new concepts, classes, modules, or subsystems that matter for orientation,
2. changed boundaries or ownership lines,
3. changed underlying assumptions,
4. new substantial features that change how an agent should navigate the code,
5. infrastructure or deployment changes that affect orientation or validation,
6. changes that require different routing guidance for future agents.

Do not update it for:

1. algorithm swaps inside an existing boundary,
2. bug fixes or edge-case fixes that preserve the same concepts and boundaries,
3. optimizations inside an existing design,
4. styling or UX look-and-feel changes,
5. local refactors that preserve the same ownership model.

## Deeper-doc threshold

Do not create deeper docs lightly.

Create a deeper doc only if at least one is true:

1. reading the doc is materially cheaper in context than reading the code,
2. the doc captures assumptions, rationale, or constraints that are hard to infer from code and tests alone.

If a deeper doc no longer clears that bar, mark it obsolete or remove it.

## Workflow

1. Read `docs/agent-docs/agent-architecture-map.md` first.
2. Inspect only the current code needed to verify the architecture claims being updated.
3. Decide the smallest required documentation change:
   - update the canonical map,
   - update an existing deeper doc,
   - add a new deeper doc,
   - obsolete or remove a stale deeper doc,
   - update `AGENTS.md` if repo-level guidance changed.
4. Preserve the distinction between:
   - descriptive content: how the code currently works,
   - normative content: architecture and code-design axioms that require user approval to change.
5. Keep the docs compressed. Use links and routing guidance instead of broad narration.
6. Update freshness metadata and cross-references whenever you touch a knowledge-base doc.
7. Verify that linked files and doc paths still exist.
8. If a code change affects durable architecture or assumptions, do not treat the task as complete until the knowledge base is updated or the user explicitly declines the update.

## Governance

Architecture and code-design axioms in `docs/agent-docs/` are normative defaults.

An agent may challenge them only when:

1. it can state a concrete reason,
2. it explains the tradeoff clearly,
3. the user approves the change.

Do not silently rewrite axioms to match an unapproved implementation change.

## Editing rules

1. Prefer changing the smallest doc surface that preserves orientation quality.
2. Keep `agent-architecture-map.md` stable and structural.
3. Keep deeper docs bounded to one subsystem or topic.
4. Historical docs under `docs/specs/` and `docs/plans/` are not canonical onboarding docs.
5. If a deeper doc becomes stale, either:
   - update it,
   - mark it obsolete and point back to the canonical map,
   - remove it and repair inbound references.
