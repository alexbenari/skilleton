---
name: typescript-coding
description: Use whenever writing, modifying, reviewing, debugging, refactoring, testing, or planning TypeScript code. Load alongside all applicable workflow, design, testing, security, and correctness skills; this skill adds TypeScript-specific type, runtime-boundary, error-encoding, module, and compiler guidance rather than replacing them.
---

# TypeScript Coding

Apply this skill as a TypeScript-specific overlay. Other applicable skills decide
the workflow and broad design, testing, security, and error-handling policy; this
skill explains how to express those decisions safely in TypeScript.

Follow explicit user and repository instructions first. Preserve established
architecture and conventions, and do not turn a touched file into a broad type,
module, dependency, or compiler migration.

## Runtime boundaries

TypeScript types disappear at runtime. Treat values from HTTP, IPC, files,
storage, environment variables, third-party libraries, and deserialization as
`unknown` until runtime parsing establishes their shape and invariants.

Parse at the earliest owned boundary and pass refined values inward:

```text
unknown -> transport/config shape -> application input -> domain type
```

- Use `parseX(input): Result<X, ParseXError>` when input is untrusted or less
  structured.
- Use `makeX(...)` or `createX(...)` for construction from already-refined
  pieces.
- Use `isX(value): value is X` only for a true predicate or type guard.
- Avoid `validateX` when the function returns a refined value; it parsed one.

Prefer the repository's established parser. A new schema or result dependency
requires the repository's normal dependency-evaluation workflow; never add one
merely to satisfy this skill. Do not pass raw DTOs, schema-inference types,
nullable bags, or `Partial<T>` through core logic unless that looseness is the
actual domain concept.

## Refined values and meaningful primitives

Use a domain or refined type when two same-shaped values are easy to confuse or a
runtime invariant matters: identifiers, parsed addresses and URLs, constrained
numbers, money, durations, byte counts, and similar values.

Centralize the runtime check and any unavoidable cast in one parser or smart
constructor:

```ts
type Brand<T, Name extends string> = T & { readonly __brand: Name };
type UserId = Brand<string, "UserId">;

function parseUserId(input: string): Result<UserId, InvalidUserId> {
  if (input.length === 0) return { ok: false, error: new InvalidUserId() };
  // SAFETY: This parser is the only production constructor for UserId.
  return { ok: true, value: input as UserId };
}
```

Do not scatter branding casts through callers. Prefer immutable values and
`ReadonlyArray<T>` when mutation is not part of the contract. Use `satisfies` to
check a value against a shape without replacing its useful inferred type:

```ts
const defaults = { autoplay: false, volume: 1 } satisfies PlayerSettings;
```

## Closed states and open behavior

Choose representation according to how variation evolves:

- Use a discriminated union for a closed set of value states, serialization
  shapes, or exhaustive state transitions.
- Use an interface or class hierarchy for an open set of independently added
  implementations whose behavior varies.
- Avoid distributing repeated switches across callers. Keep union matching and
  state transitions in the module that owns the concept.

Make closed matches exhaustive:

```ts
function assertNever(value: never): never {
  throw new Error(`Unexpected variant: ${String(value)}`);
}
```

This distinction refines, rather than overrides, repository guidance favoring
polymorphism. Preserve class-based ownership of state and invariants where that
is the local architecture. Pure methods on immutable domain objects are still
pure; a functional style does not require separating behavior from its owner.

## Encoding failure contracts

Use the applicable correctness and API guidance to decide which failures callers
must handle. In general:

- Represent domain failures and actionable operational failures as typed return
  values when callers are expected to recover, retry, degrade, translate, or
  display them.
- Throw for programmer defects, violated internal invariants, and failures for
  which the immediate caller has no meaningful response beyond cleanup and
  top-level handling.
- Translate an infrastructure exception into a typed error at a boundary only
  when doing so creates a useful contract for the next layer.

Encode an agreed value-based contract with the project's existing `Result`,
Effect, tagged union, or equivalent. Keep error unions precise near their owning
boundary; avoid collapsing everything into `AppError` until an entrypoint needs
to log or render it.

```ts
type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

Preserve the original failure as `cause: unknown` when it helps diagnosis, but
do not expose secrets or infrastructure details across an untrusted boundary.

## Strictness and escape hatches

Use the repository's compiler configuration. For a new or deliberately tightened
TypeScript boundary, consider these options together with their migration cost:

- `strict`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `noImplicitOverride`
- `noFallthroughCasesInSwitch`

Do not change project-wide compiler settings as an incidental part of another
task. Under `exactOptionalPropertyTypes`, distinguish a missing property from a
present property whose value is `undefined`; model whichever state the contract
actually means.

Avoid `any`, non-null assertions, and casts that claim more than runtime evidence
proves. Prefer `unknown`, narrowing, parsing, and explicit branches. `as const` is
safe for literal inference. When TypeScript cannot express a proven invariant,
keep the cast inside the smallest owning abstraction and add a short safety
comment explaining the runtime proof. A rare `any` also needs a narrowly scoped
lint suppression with justification.

## Modules and initialization

- Export only the contract callers need; keep helpers private and do not export
  internals solely for tests.
- Use `import type` and `export type` for type-only edges.
- Prefer direct imports from the owning module unless the repository deliberately
  exposes a stable package-level entrypoint.
- Avoid new barrel layers that obscure ownership or create cycles.
- Avoid TypeScript `namespace` except for a concrete interoperability need.
- Keep imports free of unexpected work. Start servers, open connections, read
  configuration, register handlers, and acquire resources in explicit bootstrap
  code rather than at module import time.

Follow local architecture when choosing classes versus functions. Stateful
responsibilities usually benefit from cohesive objects and explicit constructor
dependencies; genuinely stateless calculations are often clearer as functions.
Record durable boundary decisions through the repository's established
architecture-documentation mechanism. Use an ADR only when the repository
already uses ADRs or the user requests one.

## Comments and documentation

Do not add routine JSDoc when the name and signature explain the contract. Use a
documentation block only for a non-obvious constraint, invariant, side effect,
interoperability requirement, or externally imposed contract that the signature
cannot express. Use short inline comments for the reason behind an unavoidable
cast or workaround, not to narrate the code.

## TypeScript review checklist

- External runtime values remain `unknown` until parsed.
- Refined types have one trusted construction path.
- Closed unions are handled exhaustively; open behavior uses an extensible
  abstraction when appropriate.
- Failure representation matches the agreed caller contract.
- No unjustified `any`, non-null assertion, or cast was introduced.
- Optional and `undefined` states are intentional.
- Public exports are minimal and type-only edges are marked.
- Imports do not trigger hidden I/O or initialization.
- No dependency, compiler migration, ADR, or broad architectural pattern was
  introduced merely to comply with this skill.
- Comments and documentation record only information the code cannot express.
