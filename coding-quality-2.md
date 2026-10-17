# Code Design Guidelines

## Purpose and scope
This document specifies the rules to follow when writing code. These rules are for writing object-oriented layered systems. 
When coding other types of applications, such as scripts, data pipelines, framework glue, or codebases built around functional or data-oriented patterns, adjust them.

## Terms
- Layer: A part of the application with a distinct kind of responsibility, such as presentation, application orchestration, or domain behavior.
- Responsibility: The kind of work a class, module, or method is supposed to own.
- Cohesion: How strongly the behavior inside a class or module belongs together.
- Boundary: The line where one layer, class, or method hands off work to another.
- Orchestration: Workflow coordination across components or layers.
- Presentation logic: Rendering decisions and local interaction behavior.
- Domain logic: Rules and behavior that express the business or product model.

## Core principles
- Prefer designs that keep behavior close to the state and invariants they govern.
- Prefer object-oriented abstractions. Do not force classes when simpler structures such as enums, structs or records or others are the more natural fit.
- A class should represent a single concept or action. Do not grow god classes.
- In object-oriented code, a free function (a function that is not part of a class) is a design smell. It requires an explicit ownership decision; in the rare cases it is justified, a brief comment explains why.
- Prefer interfaces and capability-based polymorphism over logic that branches on type or kind - the behavior should live on the owning abstraction instead.
- Prefer explicit dependencies and clear ownership of state.
- Prefer expressing dependencies as injection of interfaces.
- Design for testability: class dependencies should be mockable. Interfaces enable this.
- Avoid over-engineering and abstractions that do not earn their cost. Small duplication is often better than premature generalization.
- Keep methods and classes at a consistent level of abstraction. If a method mixes workflow steps, domain rules, and low-level mechanics, split it.
- Extend an existing layer, class, or method only when the new behavior fits its current responsibility or is a natural extension of it. Do not spread concerns across boundaries.

## Boundaries and layering
- Setting layer, class, and method boundaries is a key design decision. For each feature, decide how to split its workflow, domain behavior, state ownership, and presentation into layers, classes and methods. Consider alternatives. Have a convincing rationale for each decision, so you can defend it. 
- Keep APIs small, intention-revealing, and hard to call incorrectly. 
- A class must not expose mutable state or mutable object references that let callers bypass its invariants.
- A method should operate at one level of abstraction.
- Before adding behavior to an existing class or module, ask whether this behavior naturally extends the existing code's responsibilities.
- No two classes should have duplicate or overlapping responsibilities, and no two methods duplicate or overlapping logic.
- Every method parameter must be used. Do not pass a parameter that can be derived directly from another parameter.
- More than three parameters often signal missing structure, confused ownership, or weak boundaries. Look for the missing concept before adding another parameter.

## Naming and code shape
- Name classes and modules by responsibility, not by implementation details.
- Interface names should start with "I". E.g. IAppSurface, not AppSurface.
- When a responsibility changes materially, rename the class or module to match it.
- Files that contain a single primary class should be named after that class.
- Name methods by what they accomplish, not how they do it.
- Name variables by the role they play in the current scope.
- Name fields by what they hold.
- Prefer code that a reader can understand quickly over clever compactness.

## Error handling
- Handle errors explicitly and make failure modes clear.
- When using callbacks and event handlers, make sure the case the callback/exception handler throws an exception is accounted for. One obvious thing to check is that any state is properly restored. 
- Diagnostics, logging and error handling code should never throw unhandled exceptions or crash in general.
- Do not duplicate error message strings. If two paths generate the same error message, get the message from a single location in the code. 

## Fine-grained coding guidelines
- Avoid shallow constructor wrapper functions - initialize directly instead. 
- Avoid obvious performance or memory inefficiencies, but do not trade clarity for speculative micro-optimizations.

## Comments

- Do not emit introductory doc blocks on methods, classes, properties or enums — C# `<summary>`/`<param>`, JSDoc `/** … @param */`, Python docstrings, or the equivalent in any language. This is a rule, not a preference.
- Do not comment an enum at all — neither the type nor its members, in any comment form. A reason worth keeping belongs on the code that acts on the values.
- Keep a doc block only where it records something the signature cannot: a non-obvious reason, constraint, or reference to external authority. Prefer moving that reason into the code as a why-comment at the place it applies.
- A docstring the runtime reads is behavior, not documentation, and stays — CLI help text (Typer, Click, argparse), MCP tool descriptions, and anything else surfaced to a user or a model at run time. If a consumer requires generated API reference documentation, raise it as a deviation rather than assuming the exception.

## Layer guidance

### Presentation/UI layer
- Contains pure rendering and local interaction behavior, encapsulated as class backed UI controls.
- UI controls own interaction surfaces and presentation state, not application workflow decisions.
- Stateless UI modules are appropriate for pure layout rules, pure copy selection, pure view-model composition, or rendering helpers that do not own control behavior.
- Each control should bind and unbind the events it owns. Truly global events should belong to a narrowly named application-level controller.
- Web applications:
    - A component can own its DOM but it must not access another component's DOM.

### Application controller layer
- The application controller layer orchestrates application workflows.
- It may read domain state in order to drive workflow, but reading domain state alone does not make code orchestration.
- Do not place UI rendering concerns or reusable presentation logic in the application controller layer.
- Do not move domain rules into the controller layer just because the controller is already coordinating a flow.
- When a workflow needs the outcome of a user interaction to continue, the interaction returns that outcome to its caller, for example as a promise or a result callback. Do not record the caller's intent in shared state for the completing component to inspect; a callee must not know which caller's workflow it resumes. Every exit path, including cancel, Escape, and closing by other means, must settle the result.

## Tradeoffs and exceptions
- Prefer duplication over abstraction when the shared pattern is still unstable or the abstraction would obscure intent.
- Follow framework conventions unless there is a strong reason not to. Local design preferences should not fight the platform without a clear payoff.

## Test reliability

Where the project lints its tests, the linter enforces the mechanical parts of these rules and review checks the rest. Disable a lint rule only for one line, with a comment saying why.

What to assert:

- Each test checks a single claim that a user or caller relies on. Its name states the scenario and that claim in domain terms.
- The one exception is an end-to-end test that follows one user workflow through several checked steps, when each step needs the state the previous one left and setting that state up again would be slow. Its name describes the workflow, and every step it names is carried out and checked. Steps that do not depend on each other belong in separate tests.
- Assert only what the requirement guarantees: the outcome a user or caller can observe. Do not assert internal or incidental details that can change without breaking the requirement, such as private DOM structure, call counts or order, exact pixel sizes, animation frames, timestamps, durations, retry counts, size limits, or encoder settings. Where exact values are incidental, assert the relationship that matters instead: the button ends left of the window controls, not at x = 1312. When the requirement does state a value, such as a 24-pixel minimum target size, assert it, taking it from the production constant or the spec; use a justified tolerance for approximate values.
- Every assertion reads something the code under test produced or changed. Avoid assertions on data the test set up itself, since it passes whatever the code does.
- Assert a mock interaction only when the interaction is the contract, such as "never sends a path to the service".
- Use exact expected values for concrete inputs. A range that admits every possible result, a substring match on an argument list, or `toThrow()` without the expected message is not an assertion.
- Write expected values from the requirement, never by copying what the code currently outputs: a copied value locks in whatever the code does, bugs included. The exception is a characterization test that records current behavior before a restructuring; name it as one, and check each recorded value, because a wrong one is a bug to fix, not to preserve.

Proving a test can fail:

- See every new or changed test fail for the right reason before relying on it: write it first, or break the behavior it names and confirm it fails with a readable message. Failing only because the code does not exist yet is not enough. If the test still passes with the behavior broken, it never reaches that behavior: fix the setup, or test it at a level that can reach it.
- Prefer stating a requirement as a positive outcome: "after the click the player is still paused", not "the click does not start playback". When it can only be negative ("never sends a file path"), the test first creates the conditions in which the forbidden thing would happen, then waits until it would have been observable; checking straight away proves nothing, and so does writing the test first.
- When the requirement is about order, B happening only after A finishes (two writes to one file never interleave; `dispose()` resolves only after cleanup), the test must be able to see the wrong order. Hold A open, for example with a deferred promise, and check that B has not started before releasing A. Check an effect right after the call that promises it, before awaiting other work that could complete it.

Timing:

- Do not use fixed sleeps, size a wait to a private constant, or assume a background operation finishes within a particular interval. Wait for an observable completion condition with a bounded timeout; control clocks, animations, and external responses in tests that need exact timing.
- After a resize, navigation, or mode change, wait for evidence that it took effect before measuring. A setup call can silently do nothing; a maximized window ignores a resize. In Playwright, prefer the retrying `expect(locator)` matchers over asserting on a value read once.
- Do not poll a value that keeps changing on its own; make the system still, or compare against a value captured at the action. Do not count microtasks; flush fully or wait on a condition.

Isolation and environment:

- Do not let tests depend on execution order, shared user data, random input, live services, or machine-specific state. Give each test explicit fixtures and isolated state, and clean up what it creates. Temporary folders, profiles, and caches live under the test's own root and are removed in `finally` or `afterEach`; when the app itself writes elsewhere, give it a test-mode location instead of cleaning up after it. Restore global patches the same way, saving the original before replacing it.
- Tests that need an optional dependency, such as a native tool, skip through one shared guard, evaluated before anything that can throw. Never resolve such dependencies at module load.
- Only layout tests may depend on the window size; they set it explicitly and confirm it took effect. Every other test must pass at any reasonable size: target elements through locators or their boxes, never fixed coordinates, and never rely on layout that a smaller display changes. CI displays are often smaller than a desktop one.
- Integration tests build the DOM from the shipped page or the control's own factory, never from a hand-copied skeleton. A stub honors the inputs that matter to the behavior under test, or the test uses the real collaborator.

Structure and gates:

- Write an end-to-end test only for a behavior that depends on something lower-level tests replace with a fake: the boundary between the app's processes, the real file system, native tools and media, the operating system's windows and full screen, or real startup and shutdown. Keep one passing path per major user workflow there. Edge cases, error variants and UI rules belong in unit tests or in integration tests that use the real page with faked services. Ask: would this test catch a bug that no unit or integration test could?
- An end-to-end test drives real controls and reaches only states a user can reach: no injected DOM nodes, synthetic events, or clicks through something that covers the target.
- Name a test file after the unit or workflow it tests.
- When a production class is renamed or split, rename its tests in the same change.
- Search for an existing test before adding one.
- Keep shared test helpers in one support folder rather than copying them between files.
- Every kind of check a test relies on, such as `tsc`, a native build, or a fixture generator, runs in pre-commit or CI; otherwise the test is not coverage.
- Do not weaken assertions or raise timeouts to make a flaky test pass. Check whether the failure reveals a product bug, then take one of three outcomes and say which in the commit message: make it deterministic; move the timing-sensitive part to a level where timing can be controlled; or remove the test and record the coverage gap.
- Never keep a test's name over a body that no longer does what the name says.
