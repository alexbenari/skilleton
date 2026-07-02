# Answers to Open Questions

These notes answer the questions in `open-issues.md`. They are background explanations for understanding the TypeScript coding standards draft, not proposed changes to the standards document.

## 1. `vi.mock` / `jest.mock` vs real seams

The draft is not saying "never use test doubles." It is saying to avoid module-level mocking as the default way to test TypeScript code.

`vi.mock` and `jest.mock` replace an imported module during a test. For example, if `password-reset.ts` imports `sendEmail` from `email.ts`, a test can use `vi.mock("./email")` to intercept that import and pretend the email module did something else.

That can be useful at framework boundaries, but it often makes tests brittle because the test knows too much about how the code is wired internally. If the implementation changes from `email.ts` to `notification.ts`, the behavior may still be correct, but the test fails because it mocked the old internal module.

A "real seam" is an explicit boundary in the code where a dependency is passed in or swapped intentionally. In TypeScript, this often means constructor injection or a small interface:

```ts
type EmailSender = {
  sendPasswordReset(email: EmailAddress, link: Url): Promise<Result<void, EmailError>>;
};

export class PasswordReset {
  constructor(private readonly emailSender: EmailSender) {}

  async requestReset(input: ResetInput): Promise<Result<void, ResetError>> {
    // ...
    return this.emailSender.sendPasswordReset(input.email, resetLink);
  }
}
```

In production, `emailSender` might be `PostmarkEmailSender`. In tests, it can be a small fake that records sent emails in memory. The test uses the public boundary rather than patching imports behind the scenes.

So the practical rule is:

- Use fakes, in-memory adapters, test databases, and constructor-injected dependencies freely.
- Avoid `vi.mock` / `jest.mock` as the first choice for core application or domain tests.
- Use module mocks sparingly for awkward third-party/framework boundaries where there is no cleaner seam yet.

## 2. "Probably remove: Handoff / continuation topics"

This item is not really a concept from the standards. It is a note about the draft's shape.

The "Handoff / continuation topics" section names areas that the draft intentionally did not cover deeply yet, such as Cloudflare patterns, Effect patterns, and more examples. For a final skill, those topics should probably not stay as a loose TODO list in the main `SKILL.md`.

Better options for the final skill are:

- Remove the section if those topics are out of scope.
- Move selected topics into separate reference files if they are useful but optional.
- Create future follow-up issues/specs for Cloudflare-specific or Effect-specific skills.

## 3. `better-result`, when available and appropriate

`better-result` is a TypeScript library for representing success and failure as values instead of using thrown exceptions for expected failures.

The general shape is:

```ts
type Result<T, E> =
  | { readonly _tag: "ok"; readonly value: T }
  | { readonly _tag: "err"; readonly error: E };
```

Instead of writing:

```ts
async function findUser(id: UserId): Promise<User> {
  // throws UserNotFound or database errors
}
```

you write:

```ts
async function findUser(id: UserId): Promise<Result<User, UserNotFound | UserStoreUnavailable>> {
  // returns ok(user) or err(error)
}
```

"When available" means the project already has `better-result` installed and uses it. "Appropriate" means it fits the local codebase and does not introduce a new dependency just for one small change.

The draft's priority is:

1. Use the project's existing result/error-value convention.
2. If the project already uses Effect, follow Effect's error model.
3. If the project already uses `better-result`, use it consistently.
4. Otherwise, use a small local `Result` union when that is clearer than adding a dependency.

The important idea is not the specific library. The important idea is that expected failures should be visible in the type signature.

## 4. Imperative shell / functional core

"Functional core, imperative shell" is a design style that separates pure decision-making from effectful work.

The functional core is the part of the code that:

- contains domain rules,
- parses and transforms values,
- computes decisions,
- avoids I/O,
- avoids hidden dependencies,
- avoids reading time, random numbers, environment variables, databases, files, or network services directly.

The imperative shell is the part of the code that:

- receives HTTP requests, CLI arguments, queue messages, or scheduled jobs,
- reads config and environment variables,
- calls databases and external APIs,
- gets the current time or random values,
- logs, traces, and reports errors,
- passes refined inputs into the functional core.

Example:

```ts
// Functional core: pure rule.
export function canSendPasswordReset(user: User, now: Instant): ResetDecision {
  if (user._tag !== "Active") {
    return { _tag: "denied", reason: "InactiveUser" };
  }
  if (user.lastResetEmailAt && minutesBetween(user.lastResetEmailAt, now) < 10) {
    return { _tag: "denied", reason: "RateLimited" };
  }
  return { _tag: "allowed" };
}

// Imperative shell: I/O and sequencing.
export async function handlePasswordResetRequest(request: Request): Promise<Response> {
  const input = parseResetRequest(await request.json());
  const user = await users.findActiveByEmail(input.email);
  const decision = canSendPasswordReset(user, clock.now());
  // send email, persist audit row, render HTTP response
}
```

This style makes the important rules easier to test because most tests can call pure functions with concrete inputs. The messy parts still exist, but they are pushed to the edges where I/O naturally belongs.

## 5. Keeping code discoverable for humans and agents

Discoverable code is code where a reader can find the right concept quickly and understand how it is meant to be used.

For humans, discoverability means:

- important concepts have precise names,
- files are named after their responsibility,
- domain concepts are not hidden in `utils.ts`, `helpers.ts`, or `misc.ts`,
- exports are intentional,
- public functions and types have JSDoc,
- tests show realistic examples of how the code is used.

For agents, discoverability also matters because agents search and navigate by names. If the code uses vague names, duplicate concepts, barrel exports, or hidden side effects, an agent is more likely to edit the wrong place or invent a parallel abstraction.

Examples:

```txt
Good:
src/billing/invoice-number.ts
src/billing/billing-period.ts
src/users/email-address.ts

Harder to discover:
src/common/utils.ts
src/helpers/string.ts
src/domain/types.ts
```

The goal is not to create many tiny files for their own sake. The goal is that a future reader can search for `EmailAddress`, find the owning module, see how to construct one, and avoid passing raw strings around by accident.

## 6. Branded/refined types vs ordinary JavaScript types

JavaScript has runtime primitive types like `string`, `number`, `boolean`, `object`, and `undefined`. TypeScript adds compile-time types on top of JavaScript, but a plain TypeScript alias does not create a new distinct type:

```ts
type UserId = string;
type OrgId = string;

function loadUser(userId: UserId) {}

const orgId: OrgId = "org_123";
loadUser(orgId); // TypeScript allows this because both are just string aliases.
```

A branded type adds a compile-time marker so TypeScript treats two meaningful strings as different:

```ts
type Brand<T, Name extends string> = T & { readonly __brand: Name };

type UserId = Brand<string, "UserId">;
type OrgId = Brand<string, "OrgId">;

function loadUser(userId: UserId) {}

const orgId = "org_123" as OrgId;
loadUser(orgId); // TypeScript rejects this.
```

A refined type is a value that has been checked to satisfy a rule. For example, `NonEmptyString`, `PositiveInt`, and `EmailAddress` are refined versions of `string` or `number`.

The safe way to create branded/refined values is through a parser or smart constructor:

```ts
type EmailAddress = Brand<string, "EmailAddress">;

class InvalidEmailAddress extends Error {
  readonly _tag = "InvalidEmailAddress";
}

export function parseEmailAddress(input: string): Result<EmailAddress, InvalidEmailAddress> {
  const normalized = input.trim().toLowerCase();
  if (!normalized.includes("@")) {
    return { _tag: "err", error: new InvalidEmailAddress("Invalid email address.") };
  }

  // SAFETY: The format check above is the only way production code can create EmailAddress.
  return { _tag: "ok", value: normalized as EmailAddress };
}
```

After parsing, downstream code can require `EmailAddress` instead of `string`. That makes accidental misuse harder:

```ts
function sendWelcomeEmail(email: EmailAddress) {}

sendWelcomeEmail("not-an-email"); // TypeScript rejects this.
```

The runtime value is still a normal JavaScript string. The brand exists at TypeScript compile time. That is why the cast needs a safety comment: TypeScript cannot prove the runtime validation happened unless the code explains where the proof came from.

## 7. Blank item

The seventh item in `open-issues.md` is blank, so there is nothing to answer yet.
