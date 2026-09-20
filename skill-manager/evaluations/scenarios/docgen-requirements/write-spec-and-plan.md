---
{
  "id": "write-spec-and-plan",
  "targetId": "docgen-requirements",
  "pins": {
    "specLocation": "docs/specs/",
    "planLocation": "docs/plans/",
    "planFormat": "PLANS.md living sections",
    "requirementNumbering": "R<n>."
  },
  "requiresRunManifest": false,
  "checks": [
    {
      "id": "structure",
      "kind": "validator",
      "command": "node \"{checksDir}/structure.js\"",
      "shell": "cmd",
      "timeoutSeconds": 120
    },
    {
      "id": "traceability",
      "kind": "validator",
      "command": "node \"{checksDir}/traceability.js\"",
      "shell": "cmd",
      "timeoutSeconds": 120
    }
  ],
  "review": {
    "dimensions": [
      "requirement coverage",
      "interpretation",
      "ambiguity handling",
      "decomposition and ordering",
      "verification steps",
      "scope control"
    ],
    "guidance": "Judge the spec and plan as work products on their own merits. Do not reward either output for matching any particular template or vocabulary; ask whether a competent engineer handed only these documents could build the right thing."
  }
}
---

Read `requirements.md` in this directory. It specifies a command-line
executable that generates a Word document under content and layout
constraints.

Produce two documents:

1. A feature spec at `docs/specs/report-builder-spec.md`. It should state the
   purpose, the goals and non-goals, the behaviour the executable must have,
   and how the requirements interact where they constrain each other.
2. An execution plan at `docs/plans/report-builder-exec-plan.md`. It should be
   self-contained enough that someone with only this repository and that file
   could build the executable, and it should carry the living sections a plan
   needs: Progress, Skill Gates, Surprises & Discoveries, Decision Log, and
   Outcomes & Retrospective.

Reference each requirement by its `R<n>.` identifier where the documents
address it, so coverage can be traced.

Decide for yourself how to interpret anything the requirements leave open, how
to decompose the work, what order to do it in, and what verification each step
carries. Record decisions and their rationale rather than leaving them
implicit. Do not write any implementation code: this task produces the two
documents only.
