# Code Design Guidelines

## Purpose and scope


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
- Prefer object-oriented abstractions. Do not force classes when simpler structures are the more natural fit. For example: [enums, struct, ...]
- A class should represent a single concept or action
- Prefer interfaces and capability-based polymorphism over logic that branches on type or kind - the behavior should live on the owning abstraction instead.
- Prefer explicit dependencies and clear ownership of state.
- Prefer expressing dependencies as injection of interfaces
- Design for testability: class dependencies should be mockable. Interfaces enable this.
- Avoid abstractions that do not earn their cost. Small duplication is often better than premature generalization.
- Keep methods and classes at a consistent level of abstraction. If a method mixes workflow steps, domain rules, and low-level mechanics, split it.
- Extend an existing layer, class, or method only when the new behavior fits its current responsibility or is a natural extension of it. Do not spread concerns across boundaries.

## Boundaries and layering
- Setting layer, class, and method boundaries is a key design decision. For each feature, decide how to split it's workflow, domain behavior, state ownership, and presentation into layers, classes and methods. Consider alternatives. Have a convincing rationale for each decision, so you can defend it. 
- Keep APIs small, intention-revealing, and hard to call incorrectly. 
- A class must not expose mutable state or mutable object references that let callers bypass its invariants
- A method should operate at one level of abstraction.
- Before adding behavior to an existing class or module, ask whether this behavior naturally extends the existing code's responsibilites.

## Naming and code shape
- Name classes and modules by responsibility, not by implementation details.
- Interface names should start with "I". E.g. IAppSurface, not AppSurface.
- When a responsibility changes materially, rename the class or module to match it.
- Files that contain a single primary class should be named after that class.
- Name methods by what they accomplish, not how they do it.
- Name variables by the role they play in the current scope.
- Prefer code that a reader can understand quickly over clever compactness.

## Error handling
- When using callbacks and event handlers, make sure the case the callaback/exception handler throws an exception is accounted for. One obvious thing to check is that any state is properly restored. 
- Diagnostics, logging and error handling code should never throw unhandled exceptions or crash in general
- Do not duplicate error message strings. If two paths generate the same error message, get the message from a single location in the code. 

## Fine-grained coding guidelines
- Avoid shallow constructor wrapper functions - initialize directly instead. 

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
- Each control should bind and unbind the events it owns. Truly global events should belong to a narrowly named application-level controller;
- Web applications:
    - A component can own it's DOM but it must not access another component's DOM

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

- Do not assert private DOM structure, incidental call counts, exact pixel measurements, animation frames, or timestamps unless the requirement guarantees them. Assert observable behavior and relationships; use a justified tolerance for approximate values.
- Do not use fixed sleeps or assume a background operation finishes within a particular interval. Wait for an observable completion condition with a bounded timeout; control clocks, animations, and external responses in tests that need exact timing.
- Do not let tests depend on execution order, shared user data, random input, live services, or machine-specific state. Give each test explicit fixtures and isolated state, and clean up what it creates.
- Do not combine several slow or failure-prone operations in one end-to-end test under a single timeout. Keep each scenario focused; cover detailed rules in unit or integration tests and reserve end-to-end tests for essential user workflows.
- Do not weaken assertions or only raise timeouts to make a flaky test pass. Check whether the failure reveals a product bug, then make the setup and observation deterministic. If real hardware or media timing is essential, run that check separately; if it cannot be made reliable, remove it and record the coverage gap.

## Code review guidelines
- First map the application's layers and responsibilities. Verify that they make sense for the app's type and goals.
- Check whether each class, module, and method has a clear responsibility and whether its behavior is cohesive.
- Check whether names are clear, proportional, and aligned with responsibility.
- Check for classes with duplicated or overlapping responsibilities.
- Check whether boundaries are in the right place across layers, classes, and methods.
- Check whether control flow is easy to follow and whether a reader can understand the code quickly.
- Verify that params are all used and that no method carries duplicate inputs when one value can be derived from another.
- Look for over-engineering, premature generalization, and abstractions that do not earn their cost.
- Review functions with more than three arguments closely. They often signal missing structure, confused ownership, or weak boundaries.
- Check whether errors are handled explicitly, whether failure modes are clear, and whether APIs make misuse difficult.
- Check whether tests names explain clearly what is being tested
- Check for obvious performance or memory inefficiencies, but do not trade away clarity for speculative micro-optimizations
- In obejct oriented code, free functions (a.k.a functions that are not part of a class) are a design smell. They require an explicit ownership decision. In the rare cases they are justified a brief comment must explain why.
