# Code Design Guidelines

## Purpose and scope
- This document applies primarily to long-lived application code in layered systems.
- It assumes object-oriented abstractions are often a good fit, but it is not a mandate to force everything into classes.
- Adapt these guidelines rather than applying them literally to one-off scripts, tests, migrations, data pipelines, framework glue, or codebases built around functional or data-oriented patterns.
- Optimize first for clarity, correctness, cohesion, and changeability.

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
- Prefer object-oriented abstractions when they improve encapsulation, ownership, and boundaries. Do not force classes when simpler structures or functions are the more natural fit.
- Aim for high cohesion. A class or module should have one cohesive reason to change.
- Prefer interfaces and capability-based polymorphism over business logic that branches on type or kind when the behavior can live on the owning abstraction instead.
- Prefer explicit dependencies and clear ownership of state.
- Avoid abstractions that do not earn their cost. Small duplication is often better than premature generalization.
- Keep methods and classes at a consistent level of abstraction. If a method mixes workflow steps, domain rules, and low-level mechanics, split it.
- Extend an existing layer, class, or method only when the new behavior fits its current responsibility or is a natural extension of it. Avoid smearing concerns across boundaries.

## Boundaries and layering
- Setting layer, class, and method boundaries well is central to good design. For each feature, decide deliberately where workflow, domain behavior, state ownership, and presentation belong.
- Each layer should own one kind of concern. For example, do not let presentation code drift into application orchestration, and do not let orchestration absorb domain behavior that belongs deeper in the model.
- A boundary should make misuse difficult. Keep APIs small, intention-revealing, and hard to call incorrectly.
- A method should operate at one level of abstraction. A class should gather behavior that belongs together. A layer should group components with the same kind of responsibility.
- Before adding behavior to an existing class or module, ask whether it shares the same reason to change. If not, create a separate abstraction instead.

## Naming and code shape
- Name classes and modules by responsibility, not by implementation details.
- When a responsibility changes materially, rename the class or module to match it.
- Files that contain a single primary class should usually be named after that class.
- Name methods by what they accomplish, not how they do it.
- Name variables by the role they play in the current scope.
- Prefer code that a reader can understand quickly over clever compactness.

## Layer guidance
### Presentation layer
- Keep pure rendering and local interaction behavior in the UI layer.
- UI components should own interaction surfaces and presentation state, not application workflow decisions.
- Stateless UI modules are appropriate for pure layout rules, pure copy selection, pure view-model composition, or rendering helpers that do not own control behavior.
- If the codebase uses class-backed controls, keep those classes focused on a concrete UI control and its local behavior. Do not treat that pattern as mandatory across every UI surface.

### Application controller layer
- The application controller layer should orchestrate application workflows.
- It may read domain state in order to drive workflow, but reading domain state alone does not make code orchestration.
- Do not place UI rendering concerns or reusable presentation logic in the application controller layer.
- Do not move domain rules into the controller layer just because the controller is already coordinating a flow.

## Tradeoffs and exceptions
- Prefer free functions when behavior is genuinely stateless, cross-cutting, or more idiomatic in the language or framework.
- Prefer duplication over abstraction when the shared pattern is still unstable or the abstraction would obscure intent.
- A class may own multiple closely related behaviors if they change together and reinforce one responsibility.
- Follow framework conventions unless there is a strong reason not to. Local design preferences should not fight the platform without a clear payoff.

## Code review guidelines
- First map the application's layers and responsibilities. Verify that they make sense for the app's type and goals.
- Check whether each class, module, and method has a clear responsibility and whether its behavior is cohesive.
- Check whether boundaries are in the right place across layers, classes, and methods.
- Verify that params are all used and that no method carries duplicate inputs when one value can be derived from another.
- Check whether names are clear, proportional, and aligned with responsibility.
- Check whether control flow is easy to follow and whether a reader can understand the code quickly.
- Look for over-engineering, premature generalization, and abstractions that do not earn their cost.
- Review functions with more than three arguments closely. They often signal missing structure, confused ownership, or weak boundaries.
- Check whether state is owned in the right place and whether invariants are enforced at the right boundary.
- Check whether dependencies point in the right direction and whether layers are being bypassed.
- Check whether errors are handled explicitly, whether failure modes are clear, and whether APIs make misuse difficult.
- Check whether tests still make sense and whether unit, integration, and end-to-end coverage match the risk of the code.
- Check for obvious performance or memory inefficiencies, but do not trade away clarity for speculative micro-optimizations.

## Review questions
- Can a reader understand the code quickly?
- Is control flow easy to follow?
- Does each abstraction earn its cost?
- Is any part over-engineered or prematurely generalized?
- Are responsibilities placed in the right layer and on the right abstraction?
- Is state owned in the right place?
- Are invariants enforced where they should be?
- Are names clear and intention-revealing?
- Are errors and failure modes explicit?
- Do the tests still reflect the intended behavior?
- Are there obvious performance or memory issues worth addressing?
