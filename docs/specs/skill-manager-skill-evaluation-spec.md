# Skill Manager Guidance Evaluation Spec

Date: 2026-07-25
Revised: 2026-09-20

## Purpose

Add a skill-manager feature for testing whether a piece of agent guidance
improves an agent's work on a realistic, file-backed task. The guidance under
test may be a skill, a project instruction file such as `CLAUDE.md` or
`AGENTS.md`, or a guidance document those files point at, such as
`coding-quality.md`. The same machinery compares execution configurations —
two agent CLIs, two models, or two reasoning efforts — under a fixed set of
guidance. The evaluation must work across guidance domains, including coding,
learning-document writing, and future artifact-oriented tasks, and across the
supported agent CLIs.

This work matters because guidance can read well but still fail to improve
agent behavior in practice. The app should help the user run repeatable A/B
evaluations, inspect the resulting artifacts, and decide whether the guidance
improved the overall task outcome.

## Goals

- Evaluate one evaluation subject on one evaluation target using paired
  baseline and guided runs.
- Support three subject kinds: a skill, a project instruction file (`CLAUDE.md`,
  `AGENTS.md`), and a referenced guidance document that an instruction file
  points at, such as `coding-quality.md`.
- Support generative targets, where the run produces a whole artifact set from
  a specification, alongside targets that are changed in place.
- Let the user review the outputs themselves, with the evaluation model as an
  alternative reviewer rather than the only one.
- Keep the quality judgment honest: a rubric fixed before the runs, blinding by
  default, and a stated sample size.
- Support two agent CLIs as execution engines, Codex and Claude, behind one
  explicit integration boundary with per-agent adapters.
- Automatically orchestrate both runs from the app in v1, while keeping the
  selected agent CLI as the execution engine behind that boundary.
- Let the user select separate execution and evaluation models for each
  evaluation, with per-agent defaults.
- Support three ways for guidance to differ between arms: absent, a prior
  version, or an alternative configuration.
- Support consolidation questions, where a set of skills is compared against a
  single guidelines document intended to replace it.
- Support execution comparisons: the same guidance configuration run on two
  agent CLIs, two models, or two reasoning efforts, as a paired evaluation.
- Support multiple task domains without making code repositories, code
  generation, or code-quality review the universal model.
- Store evaluation artifacts in a dedicated folder under skill-manager
  control.
- Support realistic evaluation targets rather than artificial toy tasks.
- Compare outputs through a domain-appropriate blackbox review of the changed
  or produced artifacts.
- Make the proposed evaluation criteria explicit and require user approval
  before the paired runs begin.
- Persist the final evaluation criteria, validation definitions, and baseline
  results so future runs can reuse and compare against them.
- Track task completion, constraint adherence, and scope control so the
  comparison is fair.
- Record how the subject was activated for each agent and what guidance context
  each run could see, so comparisons are not confounded by leaked user-global
  skills or instruction files.
- Start with one or two scenarios, including the ability to evaluate a
  learning-document-writing skill, then expand once the loop is proven.
- Make the feature part of the skill-manager app.

## Non-Goals

- No artificial insertion of known defects or writing problems just so the
  subject can fix them.
- No scoring that merely checks whether the output follows the subject's named
  rules.
- No automatic acceptance of feature-suggested validators or review criteria
  without user approval.
- No comparison against a stored arm result whose target, scenario, rubric, or
  behavioral checks differ, or which differs from the other arm in more than
  one factor.
- No assumption that every evaluation target is source code or has a test
  suite.
- No general-purpose evaluation of interactive UI, browser, or non-file-backed
  work in v1. The first execution substrate is an isolated file workspace.
- No automatic matrix in v1. One evaluation compares two arm configurations
  that differ in exactly one factor; assembling many such results into a grid
  is a later feature that the recorded data must make possible.
- No claim that a single scenario generalizes to a whole instruction file. An
  instruction-file evaluation reports evidence for the scenarios it ran.
- No multi-scenario aggregation or scenario-suite scoring in v1.
- No automatic search or ranking across many guidance configurations in v1.
  Comparing two named configurations is supported; exploring the space of them
  is not.
- No unblinded model verdicts. A model reviewer is never told which arm carried
  the subject; a user reviewer may unblind, and the report records that.
- No skill comparison/compatibility reporting in this spec.

## Product Direction

The feature should evaluate the subject as a black box:

1. prepare the same starting inputs for a baseline run and a guided run,
2. propose an evaluation plan covering validation checks and quality-review
   criteria,
3. let the user review, edit, and approve that evaluation plan,
4. run the same task with the baseline arm configuration,
5. run the same task with the candidate subject activated,
6. apply the approved plan to both outputs,
7. have the selected reviewer, the user or the evaluation model, compare the
   outputs using the approved evidence and rubric, and
8. retain the final evaluation definition and persist the run and comparison
   results.

The scoring should not simply reward the output for visibly following the
subject's target rules. The point is the overall task outcome: did the agent
complete the requested task correctly, within scope, and at an appropriate
quality level for the target domain?

The shared v1 abstraction is a file-backed evaluation target. A target may be
a source repository, a collection of Markdown learning documents, or another
folder of inputs and expected outputs. The target definition, rather than the
evaluation service, determines which validators and review dimensions apply.

The second shared abstraction is the evaluation subject. A skill, an
instruction file, and a referenced guidance document differ in how they reach
the agent, not in how they are evaluated: each is guidance whose practical
effect on a task outcome is measured by comparing two otherwise identical
runs.

The app must orchestrate the two agent runs automatically. The runner should
be an explicit integration boundary with one adapter per supported agent CLI:
it supplies the agent with the scenario prompt, isolated workspace, subject
activation, and recorded execution settings; it captures status, output,
generated artifacts, and failures; and it supports bounded execution with
cancellation. The evaluation service should depend on that capability rather
than embedding provider-specific process details in the comparison workflow.

The evaluation plan is intentionally not fully universal or fully automatic.
The feature may suggest a plan using the task, target, scenario, and the
content and stated purpose of the selected subject, but the user must approve
it before the runs are evaluated. The approved plan should explain both what
can be checked mechanically and how quality will be judged.

Each evaluation selects one agent CLI and two independently selectable model
roles within that agent:

- The **execution model** performs the task runs. When guidance is the varied
  factor it must be the same model at the same reasoning effort in both arms,
  so the guidance is the only experimental difference. When execution is the
  varied factor, it is the thing that differs, and the guidance is held fixed
  instead.
- The **evaluation model** performs the evidence-based review and comparison of
  the two outputs. It may differ from the execution model and must not modify
  either run workspace.

Model and reasoning effort are separate recorded fields, not one label. The
same model at medium and at high effort is two different execution
configurations, and a report that records only the model name cannot be
compared against another run later.

Defaults are per agent CLI:

| Agent CLI | Execution model default | Evaluation model default |
| --- | --- | --- |
| Codex | Luna (High) | Eval Sol (High) |
| Claude | Opus 5 (High) | Opus 5 (High) |

The app must show the agent selection and both model selections before the runs
start, allow the user to override either default, and record the exact selected
agent, model, and reasoning effort in the evaluation definition and report.

### Arm configurations and the varied factor

Every evaluation compares two **arm configurations** on one target and
scenario. An arm configuration is:

- the agent CLI,
- the execution model,
- the reasoning effort, and
- the **guidance set**: every subject in force, each with its version
  fingerprint and activation mechanism.

The two arms must differ in exactly one **varied factor**, declared in the
evaluation definition:

| Varied factor | What differs | What the spec calls the arms |
| --- | --- | --- |
| `guidance` | The guidance set, in one of the three ways "Guidance difference" defines | baseline and guided |
| `agent` | The agent CLI, and with it the execution model, since models are agent-specific | reference and candidate |
| `model` | The execution model within one agent CLI | reference and candidate |
| `effort` | The reasoning effort of one model on one agent CLI | reference and candidate |

"Reference" is the arm the user currently uses or treats as the status quo;
"candidate" is the contender. Under a `guidance` factor this spec keeps the
older names baseline and guided, because they read naturally there; they mean
the same two roles.

Everything else is held constant and recorded: target snapshot, scenario,
rubric, behavioral checks, evaluation model, reviewer role, repetition count,
and run settings. An evaluation whose arms differ in more than one factor is
rejected, because its result cannot be attributed to anything.

The stored unit is the **arm result**: one arm configuration plus its runs,
validation and behavioral-check results, activation records, cost record, and
artifact inventories. Comparisons reference two arm results. Any arm result is
reusable as either side of a later comparison whose other arm shares the
target, scenario, rubric, and behavioral-check fingerprints and differs in one
factor, so the grid of configurations the user eventually wants is assembled
from stored cells rather than rerun. Assembling and ranking that grid is out of
v1 scope; recording cells that make it possible is not.

## Current Architecture Context

Relevant current modules:

- `skill-manager/electron/main.js` wires Electron IPC to backend operations.
- `skill-manager/electron/preload.js` exposes the renderer bridge.
- `skill-manager/electron/active-skill-library.js` orchestrates the selected
  library and app actions.
- `skill-manager/electron/skill-library.js` resolves cataloged skills.
- `skill-manager/electron/skill-installer.js` installs skill copies into a
  project or global skill root.
- `skill-manager/ui/renderer.js` owns the current UI.

The new feature should be a separate evaluation capability. It should not be
implemented inside catalog refresh, install, or tag editing.

Skill subjects come from the active skill library. Instruction-file subjects do
not live in the skill catalog; they are selected as files, so the evaluation
capability must not assume every subject is a cataloged skill.

## Concepts

### Evaluation subject

The guidance under evaluation. It has a kind:

- `skill`: a cataloged skill from the active skill library, with its own
  directory, `SKILL.md`, and supporting files.
- `instruction-file`: an always-on project guidance document such as
  `CLAUDE.md` or `AGENTS.md`, selected as a file rather than from the catalog.
- `referenced-document`: a guidance document that is not loaded by the agent
  on its own and reaches the run only because an instruction file points at
  it, such as this repository's `coding-quality.md`.

The subject record must capture kind, source location, a content fingerprint of
the candidate version, and the fingerprint of the baseline version when the
baseline arm uses one.

The kinds differ in how the agent consumes them, and the difference is
evidence, not noise:

| Kind | Delivery | In context when |
| --- | --- | --- |
| `skill` | Trigger-gated: the agent decides whether to load it | The agent judges it relevant |
| `instruction-file` | Preloaded, counted against the agent's instruction budget | Always, every turn |
| `referenced-document` | Pointer-gated: read through a file tool | The agent follows the pointer and reads the file |

A `referenced-document` subject therefore has two failure modes an
instruction-file subject does not: the pointer may not fire, and the document
may be read partially. Both are reportable outcomes rather than quality
findings about its content.

### Pointer configuration

A `referenced-document` subject is only reachable through an instruction file
that names it. That pointer is part of the run configuration, not part of the
subject:

- the pointer text is identical in both arms, so the only difference is the
  document it resolves to,
- the pointer is recorded in the evaluation definition alongside the subject,
  because rewording it changes activation rates and therefore the result, and
- in `absent` mode the app removes the pointer and the document together. A
  pointer left dangling makes the baseline agent hunt for a missing file, which
  is a different experiment from having no guidance.

### Guidance difference

When the varied factor is `guidance`, how the guided arm's guidance set differs
from the baseline arm's. Three modes:

- `absent`: the baseline runs with no subject present. This answers "does this
  guidance help at all?"
- `prior-version`: the baseline runs with an earlier version of the same
  subject, and the guided run uses the candidate version. This answers "is this
  revision an improvement?"
- `alternative-configuration`: each arm runs a different set of guidance, which
  may differ in kind and in count. This answers "can this replace that?" — for
  example a bundle of coding skills against one consolidated guidelines
  document.

The first two modes apply to all subject kinds. `prior-version` is the expected
mode when revising an existing `CLAUDE.md`, an established skill, or a
referenced design-guidance document; `absent` is the expected mode for new
guidance.

`alternative-configuration` is the mode in which the subject is set-valued on
both sides. Everything the spec says about fingerprints, activation records,
cost, and rubric independence applies per subject in each set.

In `prior-version` mode the evaluation definition must record both version
fingerprints, and the report must state which versions were compared.

What is being compared in `prior-version` mode is the quality of the output,
not adherence to either version's rules. Whichever version produces better code
wins, judged on ordinary code-quality grounds.

Keeping that true requires one constraint on the rubric: it is fixed before the
runs, shared by both arms, and not assembled from either version's rules. A
rubric built from v2's prescriptions would score compliance with v2 while
appearing to score quality, and v2 would win by construction. Subject-specific
review pointers, which the plan may add for a skill, are therefore excluded
when the subject is a guidance document under version comparison.

The constraint binds the rubric and the model reviewer. A `user` reviewer
applies their own judgment and is not held to a script.

### Consolidation evaluations

The motivating case for `alternative-configuration` is consolidation: replacing
a set of coding skills with one short guidelines document that is easier to
maintain, on the hypothesis that the effect on output quality is the same.

This comparison is legitimate, but three things make it easy to misread, and
the app must surface all three rather than reducing the answer to a verdict.

**Delivery differs, not only content.** Skills are trigger-gated and load only
when the agent judges them relevant. A consolidated document is either always
in context or pointer-gated, and it arrives whole. So a win for the document
may come from its content, from the fact that it is always present, or from the
skills having failed to fire. The per-skill activation record decides between
these, and the report must show it. If two of six skills fired, the evaluation
compared two skills' content against the whole document, and folding in the
other four changed nothing that this run could see.

**Coverage differs.** A skill set spans many domains; one scenario exercises a
slice of it. A consolidation verdict is therefore bounded by what the scenario
touched, and the report must name both the scenarios covered and the skills
whose subject matter the scenario never exercised. Deciding to delete guidance
on evidence that never tested it is the failure mode this section exists to
prevent.

**Cost differs in kind, not only in size.** On-demand skills cost context only
when they load; an always-on document costs it every turn. The comparison to
record is therefore delivered guidance per run, which the cost record already
captures, rather than source size. A consolidated document can be
shorter on disk and more expensive in practice.

A consolidation decision is usually a `non-inferiority` question, and the
sample-size caution in "Decision framing" applies with more force here, because
the claim covers a whole domain rather than a single revision.

### Execution comparisons

When the varied factor is `agent`, `model`, or `effort`, the guidance set is
held fixed and the question is which execution configuration produces better
output under it. The typical uses are choosing between models at the same
effort, deciding whether high effort earns its cost over medium, and checking
whether a guidance configuration tuned on one agent carries over to the other.

The paired machinery is unchanged: same target snapshot, same scenario, same
rubric and behavioral checks, same reviewer, blinded review, repetition count,
verdict from the same fixed set. Four things are specific to this factor.

**Guidance is materialized per arm.** The same guidance set reaches each agent
through that agent's own mechanism — `CLAUDE.md` on one side and `AGENTS.md` on
the other, `.claude/skills/` against `.agents/skills/` — so an `agent`
comparison is a comparison of two deliveries as well as two engines. The
activation records for both arms must be shown side by side: an agent that
fires skills less often will look worse under a skill-heavy configuration for
delivery reasons, and the report must let a reader see that rather than
attribute it to the engine's coding ability. The instruction budget difference
applies too: a guidance set that Codex truncates and Claude delivers whole is
not the same configuration on both sides, and the app must flag it before the
runs.

**Effort labels are per-engine.** "High" on one agent CLI is not calibrated
against "high" on another. Within one agent, an `effort` comparison is
well-defined. Across agents, the report records both labels and does not
describe them as equal.

**The actual effort applied is recorded, not the requested one.** An adapter
must read back what the agent CLI applied where it exposes that, because a CLI
that silently clamps or ignores an effort setting turns an `effort` comparison
into a comparison of nothing. Where the CLI exposes no confirmation, the report
says the effort is as-requested and unconfirmed.

**The judge may prefer its own family.** A model reviewer tends to rate output
from its own model family more favorably. For an `agent` or `model` comparison
that includes the evaluation model's family, the app should default the
reviewer role to `both` and the report must name the evaluation model's family
next to the arms so the reader can weigh it. This is the one factor for which a
`user` review is the more trustworthy default rather than the fallback.

Blinding is weaker here than for a `guidance` comparison. Transcript style, run
manifests, and dependency choices can identify an engine to an experienced
reader, and the app cannot scrub what is intrinsic to the output. It scrubs
what it can — paths, agent names, tool names in transcripts — and records that
blinding was partial.

Execution comparisons are where the cost record does the most work. An `effort`
comparison is a cost-for-quality trade by definition, and the report should
pair the verdict with the time and token difference in the same way a
`non-inferiority` verdict is paired with guidance cost.

### Subject activation

How the selected subject is made available to a run. Activation is
agent-specific and must be recorded as part of the run record:

| Subject kind | Claude | Codex |
| --- | --- | --- |
| `skill` | Installed into the workspace project skill root, `.claude/skills/<name>/`, and loaded natively | Installed into the workspace project skill root, `.agents/skills/<name>/`, and loaded natively |
| `instruction-file` | Written to the workspace as `CLAUDE.md` or `.claude/CLAUDE.md` | Written to the workspace as `AGENTS.md` |
| `referenced-document` | Written to its workspace path, with the pointer in `CLAUDE.md` | Written to its workspace path, with the pointer in `AGENTS.md` |

Both agents also load skills from a user-global root, `~/.claude/skills/` and
`$CODEX_HOME/skills/` respectively, and both read a user-global instruction
file. Evaluation runs must not depend on that: activation uses the workspace
project scope, and the adapter must isolate the agent home so user-global
skills and instruction files do not reach either run. See "Run context
isolation" below.

Two consequences must be explicit in the report:

1. A skill subject is trigger-gated on both agents. Installing it is not the
   same as using it, so the report distinguishes "installed" from "activated".
2. An instruction-file subject authored once may be materialized under the
   agent's canonical filename. The report must record the filename used, not
   just the source path.

### Instruction-file delivery

Neither agent reads the other's instruction filename by default. Claude Code
reads `CLAUDE.md`, not `AGENTS.md`; Codex reads `AGENTS.md` and
`AGENTS.override.md`, and reads `CLAUDE.md` only if it is added to the
`project_doc_fallback_filenames` config key. A single authored subject must
therefore be materialized under each agent's own filename rather than shared
by symlink, which on Windows also requires Administrator or Developer Mode.

Discovery differs in a way that directly affects workspace placement:

- Claude loads `CLAUDE.md` and `CLAUDE.local.md` from the working directory and
  **every directory above it** at launch, and loads files in subdirectories on
  demand.
- Codex collects project docs from the **Git repository root down to the
  working directory**, taking at most one file per directory. Without a Git
  root it reads only the working directory.

Both concatenate root-to-leaf, with files nearer the working directory later
and therefore winning on conflict. So a run workspace placed inside a
repository that has its own instruction file inherits that file in both arms.

Delivery limits differ and are not cosmetic:

- Codex truncates the combined project docs at `project_doc_max_bytes`,
  32 KiB by default.
- Claude loads a `CLAUDE.md` of up to 4 MiB in full and skips a larger file.

An instruction-file subject larger than the Codex budget is delivered only in
part, and the same subject is delivered whole on Claude. The app must record
the delivered instruction byte count next to the subject's own size and flag
truncation, because a truncated subject is a different experiment from the one
the user approved.

Each agent has further guidance surfaces that an evaluation must account for,
either by isolating them or by recording them:

- Claude: `./.claude/CLAUDE.md`, `CLAUDE.local.md`, project `.claude/rules/`
  and user `~/.claude/rules/`, `@path` imports, and a managed-policy
  `CLAUDE.md` that settings cannot exclude.
- Codex: `AGENTS.override.md`, which beats `AGENTS.md` in the same directory,
  and any `project_doc_fallback_filenames` entries.

Because Claude resolves `@path` imports at launch and prompts for approval the
first time a project file imports something outside the working directory, an
instruction-file subject should be self-contained. If it imports, the run
record must state whether the imports actually loaded, since a declined or
unprompted import silently removes part of the subject.

### Run context isolation

Both arms must see the same context apart from the subject. The adapter is
responsible for ensuring that a run's guidance comes only from the prepared
workspace:

- the agent home is isolated per evaluation, so user-global skills, user-global
  instruction files, user rules, plugins, and MCP configuration do not leak
  into a run,
- the run workspace has no instruction-file ancestry: no `CLAUDE.md`,
  `CLAUDE.local.md`, `AGENTS.md`, or `AGENTS.override.md` in any directory
  above it, and no enclosing Git repository whose root carries one,
- the workspace is the discovery root for both agents, which for Codex means
  either initializing the workspace as its own Git root or accepting
  working-directory-only discovery,
- an `absent` baseline is only valid if the subject is not reachable through
  any other root, which the two rules above guarantee, and
- the isolated home's contents, the workspace location, and the delivered
  instruction bytes, or the explicit decision to inherit the user's home, are
  recorded in the run record and report.

This rules out running inside this repository's own tree. A workspace under
`skill-manager/evaluations/runs/` would sit below the repo's `CLAUDE.md` and
`AGENTS.md`, which Claude picks up by walking parent directories and Codex
picks up by walking down from the Git root, so both arms would silently
inherit this repo's guidance. On this machine `~/.codex/AGENTS.md` is itself a
copy of that guidance, which is exactly the kind of global leak an isolated
agent home has to remove. Scratch workspaces belong in an OS temp directory or
Electron user data; only fixtures, scenarios, definitions, and reports live in
the repo.

Leaked user-global guidance is a silent confound: it can make a baseline run
behave as if the subject were present, which invalidates the comparison without
producing any error.

For trigger-gated subjects, the run record should also capture an **activation
signal** with three states: `activated`, `not-activated`, and `undetermined`.
For a skill, activation means the transcript shows it was loaded or invoked;
for a referenced document, that the file was read, with the fraction read when
it can be measured. `undetermined` is used whenever the transcript does not
settle the question, and it propagates: a verdict that depends on an
undetermined activation is reported with that caveat instead of being counted
as either outcome. A guided run in which the subject never
activated is a distinct and reportable outcome, not a quality failure of its
content. Activation rate is itself a property of the guidance: a document that
the agent reliably declines to read is weak guidance even when its content is
excellent, and the report should say which of the two it observed.

### Evaluation target

A file-backed set of starting inputs and context under test. It may be:

- a fixture checked into the repository,
- a user-selected local project or document workspace, or
- a temporary copy of an existing repository or document set.

The target may contain code, Markdown, configuration, reference material,
assets, or a mixture of these. V1 should start with checked-in fixtures so the
loop is repeatable.

Targets come in two shapes, and the shape determines what evidence the run
produces:

- **Extension targets** start from existing artifacts and are changed in place.
  The evidence is a diff against the target snapshot.
- **Generative targets** start from a specification and an otherwise empty
  workspace, and the run produces the whole artifact set. There is no
  meaningful diff: the evidence is a full artifact inventory, and the
  comparison is whole-output against whole-output.

A generative target's fixture is the specification plus whatever reference
material the task legitimately needs. The paired arms produce two independent
artifact sets from the same specification, so the review compares two complete
outputs rather than two sets of changed regions.

Generative targets widen the spread between arms, because an empty workspace
leaves stack, structure, and scope open. The scenario pins the implementation
language so the arms stay comparable, leaves the rest open as measured design
work, and requires a run manifest so the app can still exercise whatever each
arm built; see "Scenario".

A target fixture must not carry instruction files of its own that would collide
with an instruction-file subject, at the workspace root or in any subdirectory:
`CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/`,
`AGENTS.md`, `AGENTS.override.md`, or any configured fallback filename. An
`AGENTS.override.md` is the sharpest case, because Codex prefers it over the
`AGENTS.md` the app just wrote. If a scenario wants such a collision
deliberately, it must declare it, and the evaluation definition must record how
it was resolved.

### Scenario

A task prompt plus metadata describing:

- the target and its starting state,
- optional setup/reset instructions,
- task constraints and scope boundaries,
- validators or validation commands,
- changed-artifact review guidance,
- expected user-visible behavior or artifact properties, and
- any domain-specific assumptions the reviewer needs.

A scenario describes the task being evaluated, not the internal rules of the
subject under test. It is independent of both the subject and the agent CLI:
the same scenario should be runnable against different subjects and on either
agent. It may provide candidate checks and review guidance, but the final
evaluation criteria live in the approved evaluation plan.

A scenario for a generative target pins as little as possible. Technical
choices are part of what the evaluation measures: picking a suitable document
library, a sensible test framework, and a project layout is design work that
good guidance is supposed to improve. A scenario that prescribes them removes
the evidence.

What a generative scenario pins:

- the implementation language, so the two arms remain comparable at all, and
- the command-line contract, which comes from the specification anyway and is
  what the behavioral checks drive.

What it leaves open, and what the review therefore treats as measured
decisions:

- libraries and dependencies, including the document-format library,
- test framework and test decomposition,
- project layout, module structure, and decomposition,
- error, validation, and conflicting-parameter behavior, and
- naming and interface design.

Because the stack is open, the app cannot know how to build or run an arm's
output. The scenario must therefore require each run to leave a **run
manifest**: the commands to install, build, test, and invoke the executable it
produced. The app uses each arm's own manifest to run that arm's behavioral
checks, so the checks stay stack-agnostic while the stack stays free. The
manifest declares the shell its commands are written for, and the app runs them
in that shell; the scenario states which shells are acceptable on the host. A
missing or wrong manifest is run evidence for that arm — a deliverable nobody
can run is a real quality result, not an infrastructure failure.

Leaving the stack open widens the spread between runs, which is a cost paid in
repetitions rather than a reason to pin it. Stack choice should appear as an
explicit review dimension, so a reviewer can say that one arm chose a better
library or a worse one.

### Evaluation plan

The user-approved definition of what evidence to collect and how to review the
two runs. It should include:

- the task outcome and acceptance behavior to evaluate,
- automated validators or checks,
- quality-review dimensions and reviewer prompts,
- any subject-specific pointers that are relevant to the task, and
- known limitations, assumptions, or evidence that cannot be automated.

The plan should evaluate the subject's practical effect, not reward mechanical
compliance with its text. The feature may use broad defaults and the subject's
stated purpose or content to draft the plan. For example:

- For coding guidance, the default may be a broad changed-code quality review
  covering correctness, maintainability, boundaries, tests, regressions, and
  scope, with optional subject-specific pointers added as review prompts.
- For `learning-doc-writing`, the proposed review may derive from the skill's
  purpose: self-containedness, correctness, clarity, structure, terminology,
  useful intuition and examples, audience fit, cross-references, and adherence
  to the document's intended scope.
- For an instruction file, the proposal may be drawn from the directives the
  document actually contains that are relevant to this scenario. Directives
  that the scenario cannot exercise should be listed as unevaluated rather than
  silently dropped.

These are suggestions, not automatic judgments. The user can accept, remove,
or revise any proposed validator or review dimension before starting the
paired evaluation.

### Evaluation definition

The persisted, versioned form of an approved evaluation plan. It includes the
final acceptance criteria, validator and behavioral-check definitions,
quality-review rubric, subject-specific pointers, the varied factor, both arm
configurations with every subject's kind, reference, content fingerprint, and
activation mechanism, the guidance difference mode when guidance is varied,
target and scenario references, evaluation model configuration, reviewer role,
decision framing, repetition count, and the assumptions needed to interpret
results.

Future runs should reuse the same evaluation definition when the user wants a
longitudinal comparison. If the definition changes, the app should create a
new version and make the change visible in the resulting report.

### Stored arm results

The persisted result of running one arm configuration on one target snapshot
and scenario. It includes the full arm configuration, the workspace or
artifacts of every run, agent CLI version and model identifier as the CLI
reports them, validator definitions and results, behavioral-check results, run
manifests, activation records, cost record, factual change descriptions or
artifact inventories, and the target, scenario, rubric, and behavioral-check
fingerprints needed to decide whether it remains comparable.

A stored arm result may serve as either arm of a later comparison without being
rerun, provided the other arm shares those four fingerprints and differs in
exactly one factor. The rule is the same for all factors: a guided arm stored
under a `guidance` comparison on Codex is a valid reference arm for an `agent`
comparison against Claude under the same guidance set. The app confirms
compatibility explicitly and reports reuse; it never reruns or replaces a
stored result silently.

Model identity drifts. A stored arm result carries the agent CLI version and
the model identifier or snapshot the CLI exposed, and a comparison that reuses
a result recorded against a different CLI version or model identifier than the
one currently available must say so in the report. The user can always rerun an
arm to establish a fresh result; this creates a new arm-result identity and
preserves the historical one.

In this spec "baseline reference" means a stored arm result used as the
baseline arm of a `guidance` comparison.

### Arms

The app starts the arm's agent CLI through the execution integration, in an
isolated workspace prepared from the target snapshot with that arm's guidance
set activated, at that arm's model and effort, and performs the scenario. Both
arms of a comparison go through the same integration with identical run
settings, so the only difference between them is the varied factor.

### Agent execution integration

The app boundary responsible for launching and supervising one agent run. It
must accept the run workspace, prompt, subject activation, and run settings;
expose progress and completion state; capture the transcript and process
result; and retain any produced artifacts or partial artifacts.

The boundary has one adapter per supported agent CLI. An adapter owns the
provider-specific parts: process invocation and arguments, model and effort
selection, workspace/sandbox configuration, authentication expectations,
subject activation mechanics, and transcript extraction. Everything above the
boundary works in agent-neutral terms.

The integration should make baseline and guided runs equivalent apart from the
evaluated subject. The app should record the agent CLI and version, execution
model, prompt, relevant environment/configuration, subject activation
mechanism, timeout, and cancellation state so a report can identify meaningful
differences or deviations.

### Evaluation-model review

A read-only model invocation that compares the baseline and guided outputs
after the runs complete, used when the reviewer role is `model` or `both`. It receives the approved evaluation plan, factual
change descriptions, relevant artifacts and nearby context, validation results,
and baseline metadata. It returns a structured, evidence-backed quality review
and conclusion for the report.

The evaluation model must not edit run workspaces, execute the task again, or
replace recorded validation results. Its role is to assess the supplied
evidence, identify uncertainty, and compare the outputs according to the
user-approved criteria.

One evaluation model, at one configuration, reviews both arms of a comparison;
it is part of what is held constant.

The review is **blinded**. The two outputs are presented as unlabeled arms in
randomized order, with no statement of which one had the subject, which
guidance version produced it, or which arm is expected to be better. Evidence
handed to the reviewer is scrubbed of arm identity, including workspace paths,
activation records, and the subject text itself. The app re-attaches the labels
after the structured review comes back.

Blinding matters most in exactly the case this feature exists for. When the
subject is quality guidance and the verdict is a judgment call, an unblinded
reviewer that knows which arm was "the improved one" tends to find that it
improved. Without blinding the report measures the reviewer's expectation as
much as the guidance.

The reviewer's own context is isolated on the same terms as a run. It sees the
approved rubric and the evidence, and not the subject, the repository's
instruction files, or any guidance document under comparison. A reviewer that
reads the candidate guidance while judging its output is scoring compliance
with it, which is the outcome this spec's non-goals rule out.

### Reviewer role

Who produces the qualitative comparison. The evaluation definition records one
of:

- `user`: the user reviews the two outputs and records the verdict. This is the
  expected mode for the first evaluations, when the point is partly to find out
  whether the automated review can be trusted.
- `model`: the selected evaluation model produces the structured review.
- `both`: both reviews are produced and recorded separately, never merged. A
  disagreement between them is a finding about the automated reviewer and
  should be visible.

For `user` review the app is a review harness rather than a judge. It must:

- present the two outputs side by side with their artifact inventories,
  validator and behavioral-check results, and run manifests,
- present the approved rubric's dimensions as the structure for the verdict,
- capture a structured result — per-dimension assessment, overall
  recommendation from the same fixed set, and free-text reasoning — so a manual
  verdict is as comparable across evaluations as a model one, and
- offer blinding, defaulting to on, with the user able to unblind at any point.

Blinding is offered rather than enforced for a human reviewer. Someone who
wrote the guidance under test can often recognize its influence anyway, and
forcing a pretense of blindness would be theater. Recording whether the review
was blinded is what matters, because it tells a later reader how much weight
the verdict carries.

A `user` review does not require an evaluation model, and the app must not
treat a missing or unavailable evaluation model as an error in that mode.

With a repetition count above one, the harness presents matched pairs — run
*i* of each arm side by side — and collects a verdict per pair before asking
for one overall verdict across the pairs. Pairing keeps the reading load
linear in the repetition count and makes the within-arm spread visible, since a
reviewer who has just judged pair one against pair two has seen how much the
same arm varies with itself.

### Decision framing

The evaluation definition records what the user intends to decide, because it
changes how much evidence the verdict needs:

- `improvement`: is the candidate better than the baseline? A clear win is
  visible with few samples.
- `non-inferiority`: is the candidate no worse, so that some other advantage —
  a shorter document, fewer skills, a cheaper model — can be taken? This is the
  harder claim. Showing that no meaningful difference exists requires more
  evidence than showing that a large one does, because every source of noise
  now argues for the conclusion instead of against it.

The framing is the user's, not the app's, and the app must not silently convert
one into the other. In particular, "inconclusive" is not "equivalent". An
`improvement` evaluation that comes back inconclusive has failed to show a win;
a `non-inferiority` evaluation that comes back inconclusive has failed to show
safety, and reading it as permission to switch is exactly the error the
distinction exists to prevent.

For a `non-inferiority` framing the app should require, or at least prompt for,
a repetition count above one before the runs start, and the report must state
the sample size next to the conclusion.

### Cost record

An equivalence result is only actionable next to what the candidate costs, and
an `effort` comparison is a cost question outright. The app records, for each
subject version:

- source size in bytes and approximate tokens,
- for an instruction file, the delivered bytes counted against the agent's
  instruction budget, and
- for a referenced document, whether the run read it and how much of it.

And for each run: execution time, and the token or cost figures the agent
reports when it exposes them.

This makes "no worse, and materially cheaper" a conclusion the report can
support with data rather than an inference the reader has to make. A shorter
guidance document that holds quality is a win on cost, and the report should
say so in those terms instead of burying it under "equivalent".

### Repetition and variance

Agent runs are stochastic, and the two kinds of variance behave differently on
a generative task with an open stack:

- **Structural variance is high.** Two runs of the same arm reliably differ in
  decomposition, file layout, naming, dependency choice, and test depth. This
  is near-certain, not a risk.
- **Quality variance is moderate and unmeasured here.** Whether those different
  structures are meaningfully better or worse varies less than the structures
  themselves, but it is not stable either, and this spec has no data on its
  size for this target.

The consequence is asymmetric. A large quality gap between arms is probably
real at one run each. A close or mixed result at one run each is not evidence
of "equivalent" — it is evidence that the sample is too small to tell.

The evaluation definition therefore carries a **repetition count** per arm,
defaulting to one. One run per arm is the right first setting: it is the
cheapest way to prove the loop works and to see whether the effect is large
enough to be obvious. Raise it when a verdict comes back close, not
preemptively. With `user` review the cost of repetitions is the user's reading
time, which is the real constraint, so the app should make raising the count a
deliberate choice rather than a default.

When the count is greater than one, the app runs the arm that many times from
the same snapshot, records every run separately, and gives the reviewer the
full set rather than a chosen representative.

The report must always state the sample size and must not describe a
single-pair result as though the difference were established. Where the
outputs differ by less than the spread within an arm, the honest conclusion is
"inconclusive", and "equivalent within the available evidence" should be
reserved for comparisons with enough samples to support it.

### Changed-artifact review

An evidence-backed review focused on artifacts changed or produced by a run,
plus the nearby context needed to judge them. It must have two distinct parts:

1. A factual change description that records what changed, such as added,
   modified, renamed, or deleted files; changed document sections; produced
   artifacts; diff/statistics; and other directly observable scope facts.
2. A qualitative review that assesses whether those changes are correct,
   complete, clear, maintainable, useful, and appropriately integrated for the
   evaluation target and approved evaluation plan.

The app derives the factual description directly from the workspace and
validator evidence. The selected evaluation model produces the qualitative
review from that evidence and the user-approved rubric.

On a generative target there is no diff. The factual description is an
inventory of the produced artifact set: files and their roles, module and type
inventory, entry points, test files and counts, dependencies declared, and
total size. The qualitative review then covers the whole output, since all of
it was produced by the run. The instruction elsewhere in this spec to compare
only what changed is an extension-target rule and does not apply here.

For a code target the qualitative review may assess changed-code quality; for a
learning-document target it may assess changed sections, headings, examples,
links, and surrounding document structure.

Files materialized purely to activate the subject, such as an injected
`CLAUDE.md` or an installed skill directory, are part of the run configuration
and must be excluded from the factual change description for that run.

The review should not let unrelated pre-existing quality dominate the result,
but it must still inspect enough context to detect broken integration or
contradictions.

### Validation result

Evidence produced by an automated command or configured check for one run.
Examples include tests, type checks, builds, Markdown structure checks, link
checks, or document-specific scripts. A scenario may also record reviewer
observations when an important property cannot be automated.

When the deliverable is a program, the strongest available evidence is the
program's own output. A scenario may define **behavioral checks**: a set of
declared invocations, run against whichever executable the arm produced, plus
assertions on the artifacts those invocations generate. For a program that
emits a document, that means opening the produced document and asserting the
layout and content constraints the specification stated, rather than trusting
the run's own tests.

Behavioral checks belong to the scenario, not to either arm. They are written
once against the specification, run identically against both outputs, and are
the only way to tell a well-structured program that does the wrong thing from
a poorly structured one that works. A generative scenario whose checks come
from the agent's own tests measures nothing, since each arm grades itself.

### Evaluation report

A comparison of the baseline and guided runs. It combines task outcome,
validation evidence, changed-artifact review, and uncertainty rather than
reducing the decision to an unexplained numeric score.

## V1 Workflow

1. User selects the varied factor: `guidance`, `agent`, `model`, or `effort`.
2. For `guidance`, User selects the subject — a skill from the active skill
   library, an instruction file such as `CLAUDE.md` or `AGENTS.md`, or a
   referenced guidance document with the pointer that reaches it — and the
   guidance difference mode, supplying the prior version or the alternative set
   the mode requires. For an execution factor, User selects the guidance set
   both arms share and the two execution configurations.
3. User selects an evaluation target fixture and scenario.
4. User selects the reviewer role and, where the varied factor does not fix
   them, the agent CLI, execution model, and reasoning effort shared by both
   arms.
5. App shows the evaluation-model selection, defaulting to the agent's default;
   the user may override it. App rejects a definition whose arms differ in more
   than one factor or in none.
6. App resolves and shows the subject activation mechanism for the selected
   agent and subject kind, including the workspace path it will write and the
   isolated agent home both runs will use.
7. App proposes an evaluation plan from the target, scenario, and the subject's
   purpose and content.
8. User reviews, edits, and approves the evaluation plan.
9. App persists the approved evaluation definition, including the varied
   factor, both arm configurations with subject fingerprints and activation
   mechanisms, and the evaluation model.
10. App either selects a compatible stored arm result for the baseline or
    reference arm, or starts a new run for it.
11. For a new baseline, App creates an isolated workspace, applies the baseline
    arm configuration, runs the baseline task automatically, captures its
    result, applies the approved validators, produces its factual change
    description, and persists the result as a reusable stored arm result.
12. For a reused baseline, App verifies compatibility and loads its stored
    artifacts, validation results, and factual change description without
    silently rerunning or replacing them.
13. App creates an isolated guided workspace from the same target snapshot
    represented by the baseline.
14. App activates the candidate subject in that workspace using the resolved
    mechanism.
15. App starts the guided or candidate run automatically under its arm
    configuration.
16. App captures guided progress, transcript, status, workspace changes,
    subject activation signal, and any execution failure.
17. App runs the approved validators for the guided output and produces its
    factual change description.
18. App repeats the paired runs until each arm has reached its repetition
    count, recording every run separately.
19. For `model` review, App invokes the selected evaluation model with the
    approved evaluation plan and collected evidence, presented as unlabeled
    arms in randomized order. For `user` review, App presents the same blinded
    evidence to the user and captures their structured verdict. For `both`,
    App does each and records them separately.
20. App re-attaches arm labels and generates a blackbox quality comparison
    report using that comparison, stating the sample size behind it.
21. App persists the validation results, evaluation-model review, and
    comparison report.
22. User reviews the report and decides whether to revise the subject,
    scenario, or evaluation target.

The user initiates the evaluation from the app, but does not need to manually
run the agent or return completed workspace paths between the two runs. The app
still delegates model execution to the selected agent CLI and should expose
cancellation and clear recovery behavior if a run cannot complete.

## Evaluation Artifacts

Proposed repository structure:

```txt
skill-manager/evaluations/
  fixtures/
    docgen-requirements/
    docgen-plan/
    learning-docs-mini/
  subjects/
    .gitkeep
  definitions/
    .gitkeep
  baselines/
    .gitkeep
  scenarios/
    docgen-requirements/
      write-spec-and-plan.md
    docgen-plan/
      implement-plan.md
    learning-docs-mini/
      improve-learning-document.md
  runs/
    .gitkeep
  reports/
    .gitkeep
```

Scenarios are grouped by evaluation target rather than by skill name, because a
scenario is a task against a target and is reusable across subjects and agents.

`subjects/` holds checked-in instruction-file subjects and captured prior
versions used for `prior-version` baselines. Skill subjects continue to live in
the active skill library and are referenced, not copied, except for the content
fingerprint and any snapshot needed to reproduce a historical run.

`runs/` holds copies of run outputs kept for the record. Runs do not execute
there: a live workspace inside this repository would inherit the repo's own
`CLAUDE.md` and `AGENTS.md`, so workspaces are prepared in an OS temp directory
or Electron user data and only their results are copied back. A retained run
should include enough metadata to reproduce or audit the comparison, including
its workspace reference, agent CLI and execution settings, subject activation
mechanism, agent home and workspace isolation record, delivered instruction
bytes, transcript or output record, exit/status result, and changed or produced
artifacts.

The retained evaluation should also record the proposed and approved
evaluation plan, including any user edits made before the runs began.

It must persist the final evaluation definition and both stored arm results,
not only the generated report. A future run should be able to load the exact
approved criteria and validation checks, inspect the baseline results, and
produce a new comparison without relying on prose copied from an old report.

The app should make evaluation-definition versions and arm-result identities
stable and visible. A report must state, for each arm, whether it reused a
stored arm result or created a new one.

It must also record the agent CLI, subject versions, and execution and
evaluation model configurations used for each historical run and comparison,
including their quality/tier selection.

Generated run artifacts and reports may later move to Electron user data if
the app needs to avoid writing inside the source tree.

## Initial Evaluation Targets

The first targets should demonstrate that the model is not coding-specific.
The design should support the following shapes.

### Document-generator targets (first planned runs)

The first planned work is a two-stage pipeline over one requirements document:
a command-line executable that generates a Word document under content and
layout constraints. The executable takes multiple command-line parameters,
resolves the constraints they express, and writes the document accordingly, so
the task carries both constraint-resolution domain logic and document-building
work.

The two stages are two targets with two scenarios, not one target with two
steps, because each stage is evaluated on its own and the second must not
depend on the live output of the first.

#### Stage 1: requirements to spec and execution plan

A generative document target. The fixture is the requirements document alone.
The run produces a feature spec and an execution plan in the repository's
format, which is the same work the Planning Flow in `CLAUDE.md` describes.

The guidance this stage exercises is planning guidance: the Planning Flow
section of the instruction file, `PLANS.md` as a referenced document, and any
planning or design skills. Code-design guidance participates only insofar as
the plan makes design decisions, which the instruction file says it must when
the document records them.

There are no behavioral checks, since nothing runs. Validators are structural:
required sections present, the plan conforms to the `PLANS.md` shape, and every
requirement is traced to at least one plan step. Traceability is only checkable
if the requirements document numbers its requirements, so the fixture should.
The review judges requirement coverage, correctness of interpretation, handling
of ambiguity in the requirements, decomposition and ordering of work,
verification steps, and scope control.

#### Stage 2: execution plan to code

A generative coding target. The fixture is the requirements document plus one
**frozen** spec and execution plan, selected by the user, fingerprinted, and
checked in. It may originate from a stage 1 output, but once chosen it is a
fixture, so that both arms of every stage 2 evaluation start from the identical
plan. Stage 2 never consumes a stage 1 arm's live output.

This is the stage the code-quality subjects are for. Its scenario pins the
implementation language and nothing else, so library and framework choice stay
part of the measured design work, and its behavioral checks open the produced
document and assert the requirements' constraints through each arm's own run
manifest.

The frozen plan is also a confound to record. The more it prescribes module and
class structure, the less a code-quality subject can move, and a stage 2
verdict then partly measures plan-following. The fixture record states how
prescriptive the plan is, and a plan that fixes what to build and in what order
while leaving structure open gives the subjects the most room. Whether to
accept a more prescriptive plan for realism is the user's call, made visible.

Neither fixture carries instruction files, starter code, or suggested structure
beyond what the frozen plan states.

### Learning-document target

Add a checked-in fixture containing one or more Markdown learning documents and
the minimum supporting context needed to revise them realistically. It should
exercise document-writing concerns such as:

- understanding the existing document's intent, reader, and structure,
- improving or extending an explanation rather than merely adding volume,
- preserving or updating the table of contents and heading hierarchy,
- keeping terminology, examples, links, and cross-references coherent, and
- producing a self-contained document at an appropriate level of depth.

A candidate scenario is to ask the agent to improve a specified learning
document or add a bounded conceptual section while preserving the document's
existing scope and voice. The fixture should use good-faith source material and
should not contain deliberately broken prose or planted omissions solely to
make a learning-document skill look useful.

The evaluation review for this target should consider document correctness,
clarity, structure, self-containedness, useful intuition/examples, and
consistency with the supplied source material. It should not score the result
by checking whether it mechanically repeats the subject's wording.

## Initial Evaluation Subjects

The first run is stage 1 of the document-generator pipeline, and its subjects
are planning guidance: the Planning Flow section of the instruction file,
`PLANS.md` as a referenced document, and planning or design skills, each
evaluated one at a time under the same three kinds and modes below. The
code-quality sequence that follows belongs to stage 2, once a plan is frozen.

The stage 2 subjects should prove all three kinds, one factor at a time:

1. **Referenced document, `prior-version`** — this repository's
   `coding-quality.md` against `coding-quality-2.md`, reached through the
   pointer in `CLAUDE.md` or `AGENTS.md`. This is the first stage 2
   evaluation. The pointer wording is held constant; only the document behind
   it changes. The rubric must be authored independently of both versions,
   because v2 adds prescriptions such as an `I` interface prefix, dependency
   injection, and testability rules that would otherwise become the scoring
   key and guarantee its own win.
2. **Skill, `absent`** — one coding skill at a time on the same scenario, with
   the guidance document held at whichever version the run is testing against.
   Because skills are trigger-gated, the activation signal decides whether the
   result says anything about the skill's content.
3. **Instruction file, `prior-version`** — a real candidate edit to `CLAUDE.md`
   or `AGENTS.md`, against a scenario the edited section actually governs. A
   revision whose scenario cannot exercise it produces no evidence, and the
   report must say so rather than reporting a tie.
4. **Consolidation, `alternative-configuration`** — the coding skill set
   against one consolidated guidelines document meant to replace it. This is
   the destination the earlier steps are building toward: if a single short
   document holds quality, it is the artifact worth maintaining.

5. **Execution, `model` then `effort`** — once a guidance configuration has
   held up, run it on Luna, Terra, and Sol pairwise at high effort, then high
   against medium on the winner. Use `user` or `both` review here, since the
   evaluation model has a family in the race.

Each of steps 1 to 3 and 5 is a separate evaluation varying one factor. The eventual
question — which combination of guidance document, skills, instruction file,
model, and reasoning effort produces the best code — is answered by assembling
these recorded results, not by a single run.

Step 4 is worth reaching deliberately rather than early. The per-skill results
from step 2 are what tell you which skills ever fired and which carried the
effect, and that is the information that makes a consolidated document worth
drafting: folding in guidance that never activated changes nothing, and folding
in guidance the scenario never exercised is untested either way. A consolidated
document drafted before that evidence exists is a guess with a test attached to
it.

Two practical cautions for the first sequence. A guidance document is unlikely
to move a generative task by more than run-to-run noise at one sample per arm,
so plan to raise the repetition count once the loop works. And skills evaluated
individually can interact once combined, so a per-skill result does not
predict a bundle's result; the bundle needs its own `alternative-configuration`
run.

## Initial Scenarios

Start with one or two scenarios. At least one initial scenario should be
chosen from a non-coding domain before the evaluation model is treated as
validated for general use.

### Scenario: Write the spec and execution plan (stage 1)

Prompt hands the agent the requirements document and asks for a feature spec
and an execution plan in the repository's format, as the Planning Flow would
produce them without the user in the loop.

The scenario pins:

- the output locations and document shapes, `docs/specs/` and `docs/plans/`
  with `PLANS.md` as the plan format, and
- the requirement numbering the traceability validator keys on.

The scenario leaves open how the requirements are interpreted, how the work is
decomposed and ordered, what verification each step carries, and what the plan
says about design.

Validators check structure and traceability. Review judges coverage,
interpretation, ambiguity handling, decomposition, verification, and scope.
There are no behavioral checks.

### Scenario: Implement the execution plan (stage 2)

Prompt hands the agent the requirements document and the frozen spec and plan,
and asks for the executable they specify, with tests and a run manifest.

The scenario pins only:

- the implementation language, and
- the command-line contract the specification already defines.

The scenario leaves open, as measured design decisions:

- the document library, test framework, and any other dependency,
- project layout and module structure,
- how the parameter and constraint rules are modeled,
- how constraint resolution is separated from document construction,
- error and validation behavior for conflicting or invalid parameter
  combinations, and
- test decomposition.

Behavioral checks run declared invocations against the produced executable,
including conflicting and invalid parameter combinations, then open the
resulting document and assert the requirements' content and layout constraints.
They are authored once from the requirements document and run unchanged against
both arms.

### Scenario: Improve a learning document

Prompt asks the agent to improve a bounded section of an existing learning
document, or add a new section that fits its intended audience and scope.

The task should require:

- reading the existing document before editing,
- preserving the author's conceptual intent and terminology,
- updating structural elements such as the table of contents when needed,
- adding useful explanation or examples rather than filler, and
- validating the result against document-specific checks and review guidance.

### Deferred scenario ideas

These may be revisited later:

- an extension target: a small existing codebase to which a feature is added,
  so the diff-based review path is exercised,
- a stage 2 variant with a deliberately less prescriptive frozen plan, to
  measure how much plan prescriptiveness suppresses the code-quality effect, and
- more learning-document tasks with different source-material or restructuring
  constraints.

## Evaluation Plan And Validation

Each evaluation target or scenario may provide candidate validators and review
guidance. The feature may add suggestions based on the subject's purpose and
content and the target domain. The user must approve the combined evaluation
plan before the paired runs start.

The approved plan defines the validators that make sense for the evaluation.
Validators are evidence, not a universal cross-domain rubric.

The app must persist both the validator definitions and each validator's
result for the baseline and guided runs. A result should include at least the
validator identity/version, command or check description, outcome, captured
output or finding, and execution context needed to interpret it.

Examples include:

- tests, type checks, lint, or builds for code targets;
- Markdown structure, link, or heading/TOC checks for document targets; and
- small target-specific scripts for configuration, data, or other artifacts.

For the stage 1 fixture the validators are structural: required sections,
`PLANS.md` conformance, and requirement traceability. For the stage 2 fixture
the install, build, and test commands come from each arm's run manifest, and
the behavioral checks come from the scenario. A learning-document fixture
should similarly define only checks that are meaningful for its documents;
human review remains necessary for qualities such as clarity, intuition, and
usefulness.

Validators run on the run workspace and must not depend on the subject being
present, so the same validator definitions apply to both arms.

## Blackbox Quality Comparison

The quality comparison should evaluate the resulting changed or produced
artifacts and the task outcome according to the approved evaluation plan, not
merely whether the output follows the subject's checklist.

The selected evaluation model performs this comparison from the captured
evidence. Its conclusion is an assessment, not a hidden validator: the report
must preserve the factual change description, validation results, review
reasoning, and uncertainty that support it.

The report should include a common core of evidence:

- task completion and expected user-visible outcome,
- validation results,
- adherence to task constraints and scope control,
- behavioral or content correctness risks,
- integration with the existing target and conventions,
- regressions, contradictions, or unrelated churn,
- quality of tests or other supporting evidence when relevant,
- subject activation evidence for the guided run, and
- an explicit account of uncertainty or missing evidence.

The approved evaluation plan may add domain-specific review dimensions. For
example, a code scenario may review maintainability, names, boundaries, and
test quality, while a learning-document scenario may review clarity, structure,
terminology, self-containedness, examples, and cross-references.

The report may include scores, but it should emphasize evidence and judgment
over false precision. The overall recommendation should be one of:

- baseline better,
- guided better,
- mixed,
- equivalent within the available evidence, or
- inconclusive.

Under a `non-inferiority` framing the report pairs the verdict with the cost
difference, so "equivalent within the available evidence, at 40% fewer
instruction tokens" is a usable conclusion and "inconclusive, at 40% fewer
instruction tokens" is visibly not one.

A guided run in which a skill subject never activated should be reported as
inconclusive for that subject's content, with the activation failure named as
the reason.

On an extension target, reviewers compare only the areas that actually
changed, plus nearby context needed to judge them. On a generative target the
whole output was produced by the run and the whole output is reviewed.

## Report Shape

Generated Markdown reports should include:

- the varied factor, and both arm configurations in full: agent CLI and
  version, execution model identifier, reasoning effort requested and applied,
  and every subject in force with its version fingerprint,
- for a `guidance` factor, the guidance difference mode and the versions or
  sets compared,
- scenario and evaluation target, with their fingerprints,
- subject activation mechanism per arm, including the workspace paths written,
- run context isolation per arm: the agent home used, the workspace location,
  and whether any user-global or ancestor guidance was in scope,
- delivered instruction bytes against each instruction-file subject's size,
  with a truncation flag,
- activation records per arm, including undetermined signals,
- decision framing, improvement or non-inferiority,
- repetition count per arm and the sample size behind the conclusion,
- cost record: guidance cost per subject version, and time and token or cost
  figures per run,
- reviewer role, the evaluation model and its family when one was used, and
  whether the review was blinded, partially blinded, or unblinded,
- the rubric, with confirmation it was fixed before the runs and, for a
  guidance-document comparison, drawn from neither version,
- proposed and approved evaluation plan, including user edits,
- evaluation-definition version,
- for each arm, whether its result was reused from storage or newly run, and
  any CLI-version or model-identifier drift against the current environment,
- validator and behavioral-check definitions, and their results per arm,
- each arm's run manifest and the stack it chose,
- factual change description or artifact inventory per arm, with workspace or
  artifact references,
- domain-specific review dimensions used,
- quality comparison with supporting evidence,
- conclusion,
- the scope of evidence, including directives or skill guidance the scenario
  could not exercise, and
- follow-up recommendations for the subject, scenario, or target.

Reports should live in a dedicated report folder:

`skill-manager/evaluations/reports/`

or a configured Electron-user-data equivalent for app-generated reports.

## UI And IPC

V1 app UI can be simple:

- select evaluation subject: a cataloged skill, an instruction file, or a
  referenced guidance document and its pointer,
- set the repetition count per arm,
- select the varied factor; for guidance, the difference mode and the prior
  version or alternative set; for execution, the two configurations,
- select evaluation target/scenario,
- select agent CLI,
- select reviewer role: user, model, or both,
- select execution and evaluation models, defaulting to the selected agent's
  defaults,
- show the resolved subject activation mechanism and run context isolation,
- review and approve the proposed evaluation plan,
- load or create an evaluation-definition version,
- select a compatible stored arm result for either arm, or request a new run,
- create/reset baseline and guided workspaces,
- start the paired evaluation automatically,
- show live baseline and guided run status and output,
- cancel or retry an incomplete run,
- run configured validators,
- review the two outputs side by side and record a structured verdict, with
  blinding on by default and an explicit unblind action,
- generate/open Markdown report, and
- show validation and run-state errors separately from evaluation findings.

IPC operations should cover:

- listing available evaluation targets and scenarios,
- selecting an evaluation subject of any kind and recording its fingerprints,
- recording the pointer for a referenced-document subject,
- setting the repetition count per arm,
- selecting the varied factor and, for guidance, the difference mode and the
  versions or sets compared,
- listing supported agent CLIs and their availability,
- listing supported execution and evaluation models and per-agent defaults,
- selecting and recording agent, activation mechanism, and model
  configurations,
- proposing and recording an evaluation plan,
- recording user approval or edits to the evaluation plan,
- loading, versioning, and reusing evaluation definitions,
- listing and selecting compatible stored arm results,
- preparing paired workspaces and activating the subject,
- starting, monitoring, canceling, and recording agent runs,
- running configured validators and behavioral checks against each arm's run
  manifest,
- presenting blinded review evidence and recording a user verdict,
- generating a report, and
- opening a report.

## Error Handling

Fail clearly when:

- no active library is selected and a skill subject is requested,
- the selected subject does not exist or cannot be read,
- a `prior-version` baseline is requested without a resolvable prior version,
- evaluation target does not exist,
- scenario does not exist or is malformed,
- the evaluation plan cannot be proposed or is not approved,
- a requested evaluation definition or stored arm result is missing,
- an evaluation definition's arms differ in more than one factor, or in none,
- a stored arm result is selected whose target, scenario, rubric, or
  behavioral-check fingerprints do not match, or which differs from the other
  arm in more than one factor,
- an `agent` comparison would deliver the shared guidance set truncated on one
  side and whole on the other,
- workspace preparation fails,
- the subject cannot be activated for the selected agent, including a collision
  with a target-provided instruction file,
- the agent home cannot be isolated, or user-global guidance would reach a run
  that is supposed to be clean,
- the prepared workspace has instruction-file ancestry that would leak into
  both arms,
- an instruction-file subject exceeds the selected agent's instruction budget
  and would be delivered truncated,
- an instruction-file subject's imports cannot be resolved or approved
  non-interactively,
- a `referenced-document` subject is selected without a pointer, or the pointer
  differs between arms,
- a generative scenario does not pin the implementation language,
- a behavioral check cannot run because the produced executable is missing or
  will not start, which is run evidence for that arm rather than an app error
  when the other arm's checks did run,
- the selected agent CLI is not installed, not authenticated, or unavailable,
- the agent execution integration cannot launch a run,
- the selected execution or evaluation model is unavailable or unsupported for
  its assigned role on the selected agent,
- the evaluation-model review cannot complete or return a structured result,
  in `model` or `both` mode,
- an agent run times out or is canceled,
- a validator cannot start,
- a run workspace is missing,
- changed-artifact or diff computation cannot be completed, or
- a report cannot be written.

Validation failures are not app errors. They are evaluation results. A
reviewer finding that an artifact is unclear, incomplete, or otherwise weak is
also an evaluation result, not an infrastructure failure.

A skill subject that was correctly installed but never activated during the run
is evaluation evidence, not an error.

An agent launch failure, timeout, cancellation, or non-success process result
is run-status evidence and must be visible in the report. It must not be
silently converted into a successful run or treated as an ordinary validator
failure. If partial artifacts exist, the app may retain them for diagnosis
while marking the run incomplete.

## Testing Expectations

Automated tests should prove:

- evaluation targets and scenarios can be listed,
- all three subject kinds can be selected and fingerprinted,
- all four varied factors are represented, a definition whose arms differ in
  more than one factor is rejected, and all three guidance difference modes
  record what they compare,
- a consolidation comparison records per-skill activation for the bundle arm and
  names the skills the scenario never exercised,
- an evaluation plan is proposed from target, scenario, and subject context,
- decision framing is recorded, and a non-inferiority evaluation left at one
  repetition per arm prompts before the runs start,
- an inconclusive result is never reported as equivalent,
- guidance cost and per-run cost figures are captured and appear in the
  report,
- the user can edit and approve the plan before execution,
- each supported agent CLI offers its own execution and evaluation model
  defaults, and the user can override either role independently,
- the final evaluation definition is versioned and retained,
- a stored arm result is reusable as either arm when the four fingerprints
  match and one factor differs, and rejected with a clear reason otherwise,
- reuse of an arm result recorded under a different CLI version or model
  identifier is flagged in the report,
- paired workspaces are created from the same source state,
- workspace reset does not mutate the fixture,
- subject activation writes the agent's canonical instruction filename for an
  instruction-file subject and the agent's project skill root for a skill
  subject, `.claude/skills/<name>/` on Claude and `.agents/skills/<name>/` on
  Codex,
- an instruction-file subject is written as `CLAUDE.md` on Claude and
  `AGENTS.md` on Codex, as a materialized copy rather than a symlink,
- both runs use an isolated agent home, and a subject installed in the user's
  global skill root or named in the user's global instruction file does not
  reach an `absent` baseline,
- a prepared workspace has no instruction-file ancestry, including no enclosing
  Git repository carrying one,
- a fixture containing `AGENTS.override.md` or another colliding instruction
  file is rejected unless the scenario declares the collision,
- an instruction-file subject over the Codex 32 KiB project-doc budget is
  reported as truncated rather than evaluated silently,
- a `referenced-document` subject is activated with an identical pointer in both
  arms, and `absent` mode removes pointer and document together,
- a referenced document that the run never read is reported as unactivated,
- a generative target produces an artifact inventory rather than a diff, and the
  comparison covers the whole output,
- behavioral checks come from the scenario and run unchanged against both arms,
- evidence handed to the evaluation model carries no arm identity, and arm order
  is randomized,
- repetition counts above one produce multiple recorded runs per arm and a
  stated sample size,
- a run records its full active configuration, including reasoning effort,
- activation artifacts are excluded from each run's factual change description,
- baseline and guided runs receive equivalent settings apart from the evaluated
  subject,
- under a `guidance` factor both arms use the same agent CLI, model, and
  effort; under an execution factor the guidance set is byte-identical in both
  arms,
- the effort actually applied is recorded separately from the effort requested,
- an `agent` or `model` comparison involving the evaluation model's family
  defaults the reviewer role to `both` and names the family in the report,
- under an execution factor, blinding is recorded as partial,
- the selected evaluation model receives the approved plan and captured
  evidence but cannot mutate either run workspace,
- a `user` review can be recorded with no evaluation model configured, and
  produces the same structured result shape as a model review,
- `both` mode records the two reviews separately rather than merging them,
- behavioral checks run against each arm's own run manifest, and a missing
  manifest is recorded as run evidence rather than an app error,
- the agent runner boundary can be replaced by a fake runner in automated
  tests, and each real adapter is selected through the same boundary,
- run progress, transcripts/output, status, failures, activation signal, and
  produced artifacts are captured as data,
- an activation signal can be `undetermined`, and a verdict that depends on it
  carries that caveat,
- evaluation definitions, validator definitions, baseline results, and review
  findings can be persisted and loaded for future runs,
- reusing a stored arm result never mutates it,
- changing the evaluation definition creates a new version rather than
  mutating historical results,
- cancellation and timeout states are represented clearly,
- validators' results are captured as data,
- report generation includes both arm configurations, the varied factor, and
  activation records,
- domain-specific review guidance is represented in the report,
- missing subject/target/scenario/run paths produce clear errors, and
- generated reports are written under the configured evaluation report folder.

Use fake completed run workspaces in tests. Do not require real agent runs in
automated tests.

## Likely Files

Likely backend additions:

- `skill-manager/electron/evaluation-service.js`
- `skill-manager/electron/evaluation-fixtures.js`
- `skill-manager/electron/evaluation-subject.js`
- `skill-manager/electron/evaluation-agent-runner.js`
- `skill-manager/electron/evaluation-agent-codex.js`
- `skill-manager/electron/evaluation-agent-claude.js`
- `skill-manager/electron/evaluation-model-reviewer.js`
- `skill-manager/electron/evaluation-definition-store.js`
- `skill-manager/electron/evaluation-report-writer.js`

The module names drop the `skill-` prefix because the subject under evaluation
is no longer always a skill.

Likely existing files touched:

- `skill-manager/electron/active-skill-library.js`
- `skill-manager/electron/main.js`
- `skill-manager/electron/preload.js`
- `skill-manager/ui/renderer.js`
- `skill-manager/ui/index.html`
- `skill-manager/tests/unit/...`
- `skill-manager/tests/integration/...`

Likely fixture/report folders:

- `skill-manager/evaluations/fixtures/docgen-requirements/`
- `skill-manager/evaluations/fixtures/docgen-plan/`
- `skill-manager/evaluations/fixtures/learning-docs-mini/`
- `skill-manager/evaluations/subjects/`
- `skill-manager/evaluations/scenarios/docgen-requirements/`
- `skill-manager/evaluations/scenarios/docgen-plan/`
- `skill-manager/evaluations/scenarios/learning-docs-mini/`
- `skill-manager/evaluations/runs/`
- `skill-manager/evaluations/reports/`

## Open Questions

1. Run workspaces cannot execute inside this repository, since both agents
   would inherit its instruction files. Given that, should retained run
   outputs and reports still be copied back under
   `skill-manager/evaluations/`, or stay in Electron user data with only
   fixtures, scenarios, and definitions in the repo?
2. How should each agent adapter launch and supervise a run non-interactively,
   and how should the app handle authentication, sandbox/approval settings, and
   model/effort selection while keeping the runner boundary replaceable for
   tests?
3. How should each adapter isolate the agent home so user-global skills,
   instruction files, plugins, and MCP servers stay out of both runs, and
   should the app ever offer an inherit-user-home mode for evaluating guidance
   in its real environment?
4. How should the app detect a skill or referenced-document activation signal
   from each agent's transcript, and how often will it have to fall back to
   `undetermined`?
5. Which model identifier does each agent CLI expose for a run, and is it
   stable enough to serve as a comparability key across weeks?
6. Should evaluation-plan suggestions come from target/scenario templates,
   subject metadata and content, a separate reviewer run, or a combination?
7. Should the learning-document fixture use one standalone Markdown file, a
   small linked document set, or a document plus source/reference files?
8. Should v1 validators be limited to executable commands, or should the
   scenario format also support structured manual review prompts and recorded
   answers?
9. Instruction files govern many behaviors that one scenario cannot exercise.
   Should v1 report only the exercised subset, or should it require the user
   to declare which directives the scenario is meant to test?
10. How should the user review harness present matched pairs when the two arms
    have different repetition counts because one arm was reused from storage?
