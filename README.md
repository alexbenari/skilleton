# skilleton

Monorepo for skill tooling, reusable skills, and agent-oriented repository docs.

## Layout

- `skill-manager/`: imported from the `skill-library-manager` repository.
- `skills/`: skill folders, starting with `json-processing/`.
- `other/`: monorepo-level `AGENTS.md` files and similar guidance/docs.

## Current contents

- `skill-manager`: app/codebase for managing the skill library.
- `skills/json-processing`: Windows-first `jq` skill for querying, filtering, aggregating, and reshaping JSON.

## Adding more skills

Future skill repos can be brought into `skills/` as subtrees, for example:

```bash
git subtree add --prefix=skills/<skill-name> <repo-url> <branch>
```

Keeping imported repos self-contained makes later subtree updates much easier.
