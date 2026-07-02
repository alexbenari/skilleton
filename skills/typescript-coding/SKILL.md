---
name: typescript-coding
description: TypeScript-specific coding guidance for agents. Use when Codex is writing, modifying, reviewing, or planning TypeScript code; especially useful for TypeScript error modeling, parsing boundaries, domain/refined types, module boundaries, dependency interfaces, adapters, tests, and strictness/safety decisions. This skill supplements general coding, design, testing, debugging, and documentation skills rather than replacing them.
---

# TypeScript Coding

## Overview

Use this skill to write TypeScript that is explicit, safe, testable, and sympathetic to the codebase already in front of you. Prefer local architecture and conventions first; apply these standards to new or touched code without forcing broad migrations.

## Decision Priority

When guidance pulls in different directions:

1. Preserve correctness, safety, and debuggability.
2. Follow explicit user instructions and repository instructions.
3. Follow established project architecture and local conventions.
4. Use general workflow/design/testing skills for process and broad design gates.
5. Apply this skill for TypeScript-specific implementation choices.
6. Avoid broad migrations unless the user asked for them.
7. Record meaningful trade-offs in comments, ADRs, or the handoff summary.

Before adding patterns, libraries, adapters, or abstractions, inspect the existing code for choices around error handling, schema parsing, dependency injection, testing, observability, adapters/services, and module layout.

## Expected Failures

Model expected failures as values. Expected failures include domain, parsing, authorization, integration, I/O, persistence, and workflow failures. Put them in the return type instead of throwing or relying on promise rejection.

Prefer the project's established error-value pattern:

1. Use Effect if the codebase already uses Effect.
2. Use `better-result`, neverthrow, a local `Result`, or another established pattern if the codebase already uses one.
3. Use a small local tagged union for the current change when no shared pattern exists and it keeps progress moving.

Recommend adopting a shared result library or shared local prelude only when typed expected failures become a repeated cross-module pattern. Do not stop an unrelated task to redesign the project's error model. Treat Effect as an architecture choice, not an incidental dependency.

Use precise custom tagged errors at module boundaries:

```ts
type Result<T, E extends Error> =
  | { readonly _tag: "ok"; readonly value: T }
  | { readonly _tag: "err"; readonly error: E };

export class UserStoreUnavailable extends Error {
  readonly _tag = "UserStoreUnavailable";

  constructor(
    readonly operation: "findActiveByEmail",
    readonly provider: "postgres",
    readonly cause: unknown,
  ) {
    super(`User store unavailable during ${operation}`);
  }
}
```

Keep error unions precise near domain/application boundaries:

```ts
Promise<Result<User, UserNotFound | UserStoreUnavailable>>
```

Avoid broad `AppError`-style types except near entrypoints, orchestration, logging, and rendering layers. Throw only for unrecoverable defects such as violated internal invariants, impossible branches, startup misconfiguration, temporary `notYetImplemented` paths, and catastrophic runtime conditions.

## Parse Boundaries

Parse early. Boundary code should turn unknown or less-structured input into domain types as soon as practical.

Prefer:

```txt
unknown -> HttpBodyDto -> CreateUserInput -> EmailAddress/UserId/etc.
```

Avoid passing raw schema inference types, raw DTOs, raw IDs, nullable bags, or `Partial<T>` through core/application logic unless that looseness is the domain concept.

Use names that preserve meaning:

- `parseX(input): Result<X, ParseXError>` for untrusted or less-structured input.
- `makeX(...)` or `createX(...)` for smart constructors from already-typed pieces.
- `isX(value): boolean` for true predicates.
- `assertX(...)` rarely, mostly at tests/framework boundaries.

Avoid `validateX` when the function returns a refined value. It parsed something.

Use schema libraries as boundary parsers, not as ad-hoc validators sprinkled through core logic. Prefer the repo's established schema library. In Effect codebases use Effect Schema. Prefer Standard Schema compatibility for generic helpers when relevant. Otherwise prefer a mainstream parser such as Zod, or hand-written smart constructors for small domain types when clearer.

## Domain And Refined Types

Use branded, refined, or domain-specific types for meaningful primitives:

- IDs: `UserId`, `OrgId`, `WorkflowId`
- parsed strings: `EmailAddress`, `NonEmptyString`, `Url`
- constrained numbers: `PositiveInt`, `Cents`, `Percentage`
- units: `Milliseconds`, `Bytes`, `UsdCents`

A branded type is a TypeScript compile-time distinction over a runtime value, usually created by a parser or smart constructor. A refined type is a value that has been checked to satisfy a rule.

```ts
type Brand<T, Name extends string> = T & { readonly __brand: Name };
type EmailAddress = Brand<string, "EmailAddress">;

export function parseEmailAddress(input: string): Result<EmailAddress, InvalidEmailAddress> {
  const normalized = input.trim().toLowerCase();
  if (!normalized.includes("@")) {
    return { _tag: "err", error: new InvalidEmailAddress() };
  }

  // SAFETY: The format check above is the only production path that creates EmailAddress.
  return { _tag: "ok", value: normalized as EmailAddress };
}
```

Use safety comments for branding casts or other casts TypeScript cannot prove. Do not use non-null assertions. Branch, parse, or refine instead.

Model meaningful lifecycle states with tagged unions or equivalent value classes:

```ts
type Invoice =
  | { readonly _tag: "Draft"; readonly id: InvoiceId; readonly lines: ReadonlyArray<LineItem> }
  | { readonly _tag: "Sent"; readonly id: InvoiceId; readonly sentAt: Instant }
  | { readonly _tag: "Paid"; readonly id: InvoiceId; readonly paidAt: Instant };
```

Avoid boolean parameters that control behavior. Prefer named options or domain values:

```ts
createUser(input, { emailVerification: "skip" });
```

Booleans are fine as clear predicate returns, such as `isExpired(token)` or `hasPermission(user, permission)`.

## Modules And Boundaries

Design deep, cohesive modules. A deep module hides substantial behavior or invariants behind a low-burden interface. Avoid shallow wrappers that only forward calls, mirror tables, or expose implementation steps.

Use the deletion test:

- If deleting the module makes complexity disappear, it was probably pass-through waste.
- If deleting it spreads complexity across callers, it was probably earning its keep.

Prefer domain modules for core concepts. A domain module centers on one primary type or tightly related type family and exposes cohesive operations such as parsers, smart constructors, combinators, predicates, formatting helpers, and test arbitraries.

```ts
// email-address.ts
export type EmailAddress = Brand<string, "EmailAddress">;
export function parse(input: string): Result<EmailAddress, InvalidEmailAddress>;
export function toString(email: EmailAddress): string;
export function equals(left: EmailAddress, right: EmailAddress): boolean;
```

Domain modules may be plain functions, classes, or static-style classes when cohesive. If using classes for domain values, construct through `parse`, `make`, or smart constructors; make invalid instances unconstructable; keep fields readonly from callers; keep behavior cohesive over that value; and avoid hiding dependencies or I/O inside domain values.

Use application/service modules for real capabilities or operations such as `PasswordReset`, `Billing`, `Invitations`, or `SubscriptionLifecycle`. Prefer classes with constructor injection when a module has dependencies, stateful resources, configuration, or multiple cohesive operations. Avoid vague names like `Manager`, `Processor`, `Helper`, or generic `UserService` unless established by the project.

## Dependencies And Adapters

Depend on the smallest meaningful shape a module actually uses. Let concrete adapters be wider.

```ts
type UsersForPasswordReset = {
  findActiveByEmail(email: EmailAddress): Promise<Result<ActiveUser, UserLookupError>>;
};

export class PasswordReset {
  constructor(private readonly users: UsersForPasswordReset) {}
}
```

A wider concrete adapter can satisfy that structural type without forcing every caller to depend on the whole adapter.

Before creating a new adapter or service, audit existing adapters/services:

1. Reuse an existing adapter as-is through a narrow dependency type.
2. Extend an existing adapter if the new method fits its cohesive capability and changes for the same reason.
3. Create a new adapter only when reuse or extension would create bad coupling or an accidental interface.

Create an ADR for a meaningful new adapter/service after the audit. Do not require an ADR for tiny local test adapters, obvious in-memory fakes, or trivial framework glue.

Avoid repository-per-table by default. Repository-like adapters are acceptable when they represent a cohesive domain persistence capability and expose meaningful domain operations returning parsed domain types and typed errors. Keep raw database rows and ORM models inside infrastructure adapters or persistence modules.

## Functional Core And Imperative Shell

Prefer a functional core with an imperative shell.

The functional core contains domain logic, parsers, state transitions, combinators, and decision functions. It avoids I/O, hidden dependencies, ambient time/randomness, thrown expected failures, and framework-specific concerns.

The imperative shell parses untrusted input, sequences effects, calls the core with refined values, classifies external failures into typed errors, and handles I/O, persistence, HTTP, queues, telemetry, time, and randomness.

Keep entrypoint adapters thin. They should parse protocol-specific input, invoke shared modules, and render protocol-specific output. Do not duplicate business rules in controllers, resolvers, workers, or CLI handlers. Put shared authorization policy in application/domain modules; entrypoints may authenticate but should pass parsed authorization inputs such as `AdminUser`, `Session`, `Principal`, or `CommandActor`.

Use database transactions for simple single-boundary operations. Use a saga or durable workflow when the process needs retries, compensation, idempotency, resumability, timers, human approval, cross-service coordination, or multiple transaction boundaries. Do not hold database transactions open across network calls or long-running work.

Any command, job, or workflow step that may be retried needs an explicit idempotency strategy, such as an idempotency key, natural unique constraint, deduplication record, state-machine transition guard, or transactional outbox/inbox.

## Testing TypeScript

Prefer confidence-oriented tests:

1. End-to-end tests for critical user flows.
2. Integration tests through real seams.
3. Focused or property tests for pure domain modules.
4. Unit tests when they test meaningful behavior, not implementation details.

Avoid `vi.mock` and `jest.mock` for module mocking by default. A real seam is an explicit boundary where a dependency is passed in or swapped intentionally: constructor-injected interfaces/classes, Effect services/layers, local database substitutes, in-memory adapters, or fake external adapters.

Prefer tests that assert observable behavior:

- returned value or typed error,
- persisted state,
- emitted event/message,
- rendered response,
- sent email or external request recorded in a fake adapter.

Avoid spy-driven tests such as `expect(sendEmail).toHaveBeenCalledWith(...)` unless the interaction itself is the only observable behavior.

For persistence behavior, prefer SQLite/local DB-backed tests when SQL, schema, or transaction behavior matters. Use in-memory fakes when the persistence mechanics are not the behavior under test.

Use `fast-check` where properties are clearer than examples, especially for parsers/smart constructors, branded/refined types, state machines, serialization roundtrips, normalization/idempotence, and lawful combinators. Place arbitraries near the domain module they support when practical.

## TypeScript Style And Safety

Use strict TypeScript settings where practical:

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`

Prefer immutable values:

```ts
type CreateUserInput = {
  readonly email: EmailAddress;
  readonly roles: ReadonlyArray<Role>;
};
```

Mutation is acceptable inside localized imperative shell code, performance-sensitive internals, builders, or adapters when hidden behind a precise interface.

Avoid:

- `any`,
- non-null assertions,
- casts with `as Type`.

`as const` is fine. Rare exceptions are allowed for highly generic helpers, branding internals, interop boundaries, or combinators where TypeScript cannot express the invariant. Add a safety comment for non-`as const` casts and a targeted lint ignore with justification for rare `any`.

Prefer direct imports from the file that owns the abstraction. Avoid barrel files and `index.ts` re-export layers by default.

Use namespace imports when they preserve a domain module shape:

```ts
import * as EmailAddress from "./email-address";

EmailAddress.parse(input);
```

Use named imports for classes, prelude helpers, and focused shared helpers. Use `import type` and `export type` for type-only imports and exports.

Export only what callers should use. Keep internal helpers unexported unless intentionally shared. Do not export internals only for tests. Avoid TypeScript `namespace` unless there is a compelling interop reason.

Use precise file names such as `email-address.ts`, `billing-period.ts`, `string-case.ts`, or `prelude.ts`. Avoid vague files such as `utils.ts`, `helpers.ts`, `common.ts`, and `misc.ts`. `prelude.ts` is acceptable for tiny ubiquitous generic helpers/types such as `casesHandled`, `shouldNeverHappen`, `notYetImplemented`, `Redacted`, common `Result` helpers, and broad type utilities. Do not put domain/application policy in `prelude.ts`.

## Comments And JSDoc

Use comments to explain invariants, trade-offs, non-obvious domain rules, and safety justifications. Avoid comments that narrate obvious code.

Use a soft JSDoc default: document exported symbols when the name and TypeScript signature do not fully explain the contract. Strongly prefer JSDoc for exported domain types, parsers, adapters, public services, side effects, invariants, and typed-error returns.

Use `@throws` only for unrecoverable defects, framework-required behavior, or temporary `notYetImplemented` paths. Do not document expected typed errors as throws.

## Configuration And Resources

Parse environment/config at startup or the earliest boundary into typed config with branded/redacted values where appropriate. Do not read `process.env` throughout the app. Missing or invalid config is a startup failure with useful context.

Do not put secrets in errors, traces, logs, or snapshots. Use a `Redacted<T>` wrapper for sensitive values such as tokens, API keys, passwords, raw credentials, and secrets. Prefer Effect's `Redacted.Redacted` in Effect codebases or a local `Redacted<T>` in `prelude.ts`.

Avoid top-level side effects except in true entrypoint/bootstrap files. Modules should not start servers, open connections, read env, register handlers, or perform I/O at import time.

Create and clean up resources explicitly in bootstrap/imperative shell code or Effect layers when using Effect. Avoid mutable singletons/global state. Constants and pure lookup tables are fine. If a framework/runtime requires a singleton, isolate it at the boundary. Inject `Clock` and `Random` services into dependency-bearing modules; pure domain functions may accept explicit `now` or random values.

## Agent Checklist

Before coding:

- Read existing conventions for errors, schemas, tests, adapters, telemetry, and module layout.
- Look for existing domain modules/types before creating new ones.
- Look for existing adapters/services before creating a new one.
- Parse inputs at the edge and use domain types internally.
- Avoid raw DTOs, raw IDs, nullable bags, and `Partial<T>` in core/application logic.
- Prefer typed errors as values for new expected failures.
- Preserve existing observability/error mechanics.
- Test through public interfaces and real seams.
- Use `fast-check` arbitraries for generated test data when practical.
- Add JSDoc where exported contracts need more than the signature.
- Add ADRs for meaningful new adapters/services created after an adapter reuse audit.
