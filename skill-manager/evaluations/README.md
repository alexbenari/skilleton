# Evaluation catalog

This folder is the checked-in half of the guidance evaluation feature: the
fixtures, scenarios, and guidance snapshots that evaluations run against. The
generated half — definitions, arm results, comparisons, and reports — lives
outside the repository, because both agent CLIs would otherwise inherit this
repository's own `CLAUDE.md` and `AGENTS.md` into every run workspace.

See `docs/specs/skill-manager-skill-evaluation-spec.md` for what an evaluation
is and `docs/plans/skill-manager-skill-evaluation-exec-plan.md` for how it is
being built.

## Layout

    evaluations/
      fixtures/<target-id>/
        target.json
        content/          starting files copied into every run workspace
        checks/           optional check scripts the scenario invokes
      scenarios/<target-id>/<name>.md
      subjects/           instruction files, referenced documents, pointers

Generated data defaults to `skill-manager/evaluations-data/` for the command
line and to `<userData>/evaluations/` inside Electron. Override either with
`SKILL_MANAGER_EVALUATION_CATALOG` and `SKILL_MANAGER_EVALUATION_ROOT`.

## Target format

`fixtures/<target-id>/target.json`:

    {
      "id": "docgen-plan",
      "shape": "generative",
      "description": "Frozen spec and plan for the Word document generator."
    }

`id` must equal the directory name. `shape` is `generative` when the run
produces a whole artifact set from a specification, or `extension` when it
changes existing files in place. A `content/` directory is required; it is the
snapshot copied into each arm's workspace.

A fixture must not contain `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`,
`.claude/rules/`, `AGENTS.md`, or `AGENTS.override.md`. Those would collide
with an instruction-file subject, and `AGENTS.override.md` would silently beat
it on Codex.

## Scenario format

A scenario is one Markdown file with a JSON front matter block fenced by lines
containing exactly `---`, followed by the prompt as the body. Front matter is
JSON rather than YAML because the shape nests lists of objects and a
hand-rolled YAML subset would be a parser with its own bugs.

    ---
    {
      "id": "implement-plan",
      "targetId": "docgen-plan",
      "pins": { "language": "python" },
      "requiresRunManifest": true,
      "checks": [
        { "id": "unit", "kind": "validator", "command": "manifest:test", "timeoutSeconds": 600 },
        { "id": "docx-constraints", "kind": "behavioral", "command": "node ../checks/docx-constraints.js", "timeoutSeconds": 600 }
      ],
      "review": {
        "dimensions": ["correctness", "decomposition", "naming", "tests", "stack choice"],
        "guidance": "Judge the output on ordinary code-quality grounds."
      }
    }
    ---

    Build the executable the requirements describe, with tests.

Fields:

- `id` must be unique across the whole catalog.
- `targetId` must equal the enclosing directory name.
- `pins` records what the scenario fixes for both arms. Pin as little as
  possible: technical choices the scenario leaves open are what the evaluation
  measures.
- `requiresRunManifest` demands that each run leave `run-manifest.json` at the
  workspace root declaring its shell and its install, build, test, and run
  commands. Without it the app cannot exercise an output whose stack it does
  not know.
- `checks` are scenario-owned commands run in the arm's workspace. `kind` is
  `validator` (the output's own correctness gates) or `behavioral` (running
  the produced program and asserting properties of what it emits). `command`
  is either a literal command or `manifest:<install|build|test|run>`, which
  resolves through that arm's run manifest.
- `review.dimensions` seeds the rubric. At least one is required.

A check script prints one JSON object on stdout:

    { "status": "pass" | "fail" | "error", "summary": "...", "findings": [ { "id": "...", "message": "...", "severity": "..." } ] }

Checks belong to the scenario, not to either arm. They are written once
against the specification and run unchanged against both outputs; a scenario
whose checks come from the agent's own tests measures nothing.

## Subjects

`subjects/` holds instruction-file and referenced-document subjects, including
captured prior versions used as the baseline arm of a `prior-version`
comparison, and the pointer text that reaches a referenced document. Skill
subjects stay in the active skill library and are referenced by path.

The pointer text for a referenced document must be identical in both arms. It
is part of the run configuration, not part of the subject: rewording it changes
how often the agent reads the document and therefore changes the result.
