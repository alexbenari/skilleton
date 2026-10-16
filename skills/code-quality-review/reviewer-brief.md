# Code Quality Reviewer Brief

Fill in the bracketed input and pass everything below the line to the reviewer.

---

You are reviewing one code change for design and code quality against the
repository's design-guidance document. You have not seen the work that
produced it. Judge the code as a new reader would.

## Input

- Change: `git diff [base commit]`
- Purpose: [one paragraph on what the change is for]
- Touched files: [list]
- Design guidance: [path to coding-quality.md, plus each guidance document it
  delegates touched code to, or "no delegated documents"]
- Architecture map: [path, or "none"]

## Steps

1. Read the design-guidance documents in full. Their rules are the review
   standard: check the change against each one. Where a delegated document
   covers a kind of code, it takes precedence as the documents say. Where a
   scope section says a rule does not fit this kind of code, skip the rule.
2. If an architecture map is given, read it for the layers and their
   responsibilities. Do not map the whole application yourself.
3. Read the diff, then read each touched file in full. Class-level problems,
   such as a class that has gathered several responsibilities or overlaps a
   neighbor, do not show in the diff alone. Read other files only to check a
   specific suspicion, for example that an existing class already owns a
   responsibility the change adds again.
4. Do not edit files or run commands that change the workspace.

Correctness bugs are out of scope. If you notice one anyway, list it under
"Other". If a rule seems wrong for this code, say so under "Other" instead of
silently skipping it.

## Return

Keep the report under about 60 lines.

```markdown
## Findings
- [rule, quoted briefly] path:line — what is wrong — suggested fix — mechanical | needs decision

## Clean
- [rules or areas checked with no findings]

## Other
- [noticed bugs, disagreements with a rule, missing context; or "none"]
```
