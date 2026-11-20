---
{
  "id": "plan-and-implement",
  "targetId": "anchor-word-spec",
  "pins": {
    "language": "C#",
    "planLocation": "docs/plans/anchor-word-exec-plan.md",
    "planFormat": "PLANS.md living sections",
    "cliSurface": "as the signed-off spec defines it"
  },
  "requiresRunManifest": true,
  "checks": [
    {
      "id": "build",
      "kind": "validator",
      "command": "manifest:build",
      "timeoutSeconds": 900
    },
    {
      "id": "test",
      "kind": "validator",
      "command": "manifest:test",
      "timeoutSeconds": 900
    },
    {
      "id": "default-composition",
      "kind": "behavioral",
      "command": "node \"{checksDir}/default-composition.js\"",
      "shell": "cmd",
      "timeoutSeconds": 600
    },
    {
      "id": "file-safety",
      "kind": "behavioral",
      "command": "node \"{checksDir}/file-safety.js\"",
      "shell": "cmd",
      "timeoutSeconds": 600
    }
  ],
  "review": {
    "dimensions": [
      "correctness against the requirements",
      "layering and responsibility boundaries",
      "naming and readability",
      "error handling and failure modes",
      "test design and coverage",
      "plan quality and plan-following",
      "scope control",
      "stack and dependency choices"
    ],
    "guidance": "Judge the plan and the code as the work of an engineer handed the signed-off spec. Do not reward vocabulary, structure or rituals that mirror any guidance document; ask whether a maintainer could extend this code safely, whether failures are explicit and specific, whether the tests would catch a regression in the requirements, and whether the plan was followed and records the decisions it made."
  }
}
---

This repository holds a signed-off feature specification,
`GT-anchor-word-composition-spec.md`, and the requirements document it was
written from, `anchor-word-requirements.md`. The spec is the source of truth
for behaviour. Where the two disagree, follow the spec and record the
disagreement in the plan.

Your task has two parts, done in this one session without waiting for anyone:

1. Write the execution plan at `docs/plans/anchor-word-exec-plan.md`. Treat
   the spec's "Sign-Off Decisions" as accepted, including the command-line
   surface and its option names. Its "Open Decisions Deferred" are yours to
   decide, with one fixed: the implementation language is C# on the .NET SDK
   installed on this machine. Libraries, project layout and packaging are your
   decisions. Record each decision and its rationale in the plan.
2. Execute the plan to completion: implement the tool in C# with its tests,
   and keep the plan's living sections current as you go.

No user is available during this task. Any step in the repository
instructions that asks for a user sign-off or a user decision is waived here;
decide, record the decision, and proceed. If a skill the instructions mention
is not available in this environment, note that in the plan and continue.

When finished, leave `run-manifest.json` at the repository root:

    {
      "shell": "cmd",
      "install": "<restores dependencies; omit if build does it>",
      "build": "<builds everything>",
      "test": "<runs every test>",
      "run": "<starts the tool>"
    }

`shell` is one of `cmd`, `powershell`, `pwsh`, `bash` or `sh`, and every
command runs from the repository root in that shell. The `run` command must
accept the tool's own options appended after it, so that

    <run> --anchor cat --output poems/cat.docx

performs that request; with `dotnet run` that means ending the command with
`--`. The run command should not rebuild on every invocation once a build has
happened.

Do not write outside this repository. Do not leave generated documents in the
repository; automated checks will exercise the tool afterwards through the run
manifest.
