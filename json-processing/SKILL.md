---
name: jq-json-processing
description: Use when working with large, nested, repeated, or noisy JSON where jq is clearly more effective than a simple PowerShell read, such as filtering arrays, extracting repeated nested fields, computing grouped counts, or reshaping API responses. Do not use for trivial top-level field reads or simple existence checks.
---

# jq JSON Processing

Windows-first workflow for processing JSON with `jq`.

## Quick triage
- Use `jq` when at least one of these is true:
  - the JSON is large, deeply nested, repeated, or noisy
  - the query touches repeated array elements
  - the task needs filtering, grouping, deduping, or reshaping
  - the output from another tool needs aggressive narrowing before being returned
- Do not use `jq` when all of these are true:
  - the task is a single top-level or shallow field read
  - there is no filtering or transformation
  - PowerShell can answer it with one short expression
  - installing `jq` would cost more than the task itself

## When to use
- Query or extract data from large, nested, repeated, or noisy JSON.
- Filter arrays or objects with conditions.
- Aggregate, reshape, or summarize JSON results.
- Narrow noisy command output before returning it to the user.

## Workflow
1. Detect `jq` before writing ad hoc JSON-processing code:
   ```powershell
   Get-Command jq -ErrorAction SilentlyContinue
   jq --version
   ```
2. If `jq` is missing, install it on Windows.
   Preferred:
   ```powershell
   winget install --id jqlang.jq -e
   ```
   Fallback:
   ```powershell
   scoop install jq
   ```
3. After install, verify:
   ```powershell
   jq --version
   ```
4. Use `jq` only when it materially reduces complexity or output volume compared with a short PowerShell expression.
5. Return the narrowest useful result. Avoid dumping entire JSON documents unless the user asked for that.

## PowerShell conventions
- Prefer reading files directly with `jq file.json` when possible.
- When piping file content, use `Get-Content -Raw`:
  ```powershell
  Get-Content data.json -Raw | jq '.items'
  ```
- Prefer single-quoted jq programs in PowerShell:
  ```powershell
  jq -r '.user.email' data.json
  ```
- For dynamic values, prefer `--arg` or `--argjson` over string interpolation:
  ```powershell
  jq --arg status "active" '.items[] | select(.status == $status)' data.json
  ```
- For file rewrites, write to a temporary file and replace the original only after the command succeeds.

## When not to use jq
- The task is a trivial top-level read and PowerShell is clearly shorter.
- The task is a simple existence check.
- Installing `jq` would cost more than the task itself.
- The JSON transform is better handled by existing project code.
- The data is not JSON.

## Fallback
- If install is blocked or unavailable, use PowerShell or Python and say that `jq` was not available in the environment.

## References
- PowerShell recipes: `references/windows-recipes.md`
- Official download page: [jqlang.org/download](https://jqlang.org/download/)
- Official manual: [jqlang.org/manual](https://jqlang.org/manual/)
