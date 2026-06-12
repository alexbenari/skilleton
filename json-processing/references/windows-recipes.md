# Windows jq Recipes

Use these PowerShell-oriented recipes when `jq` is available.

## Discovery and install

Check whether `jq` is available:

```powershell
Get-Command jq -ErrorAction SilentlyContinue
jq --version
```

Install with `winget`:

```powershell
winget install --id jqlang.jq -e
```

Fallback install with `scoop`:

```powershell
scoop install jq
```

## Basic inspection

Pretty-print a file:

```powershell
jq '.' data.json
```

Inspect the top-level type:

```powershell
jq 'type' data.json
```

List top-level keys:

```powershell
jq 'keys' data.json
```

## Common extraction

Extract a field:

```powershell
jq -r '.fieldName' data.json
```

Extract a nested field:

```powershell
jq -r '.user.email' data.json
```

Extract array elements:

```powershell
jq -r '.items[].name' data.json
```

Optional field access:

```powershell
jq -r '.items[] | .email? // empty' data.json
```

## Filtering

Filter active items:

```powershell
jq '.items[] | select(.active == true)' data.json
```

Filter by a dynamic value:

```powershell
jq --arg status "active" '.items[] | select(.status == $status)' data.json
```

Filter nested values:

```powershell
jq '.users[] | select(.profile.country == "US") | {id, email: .profile.email}' data.json
```

## Distinct values and counts

Distinct scalar values:

```powershell
jq -r '.items[].status' data.json | Sort-Object -Unique
```

Distinct values already collected into an array:

```powershell
jq '.items | map(.status) | unique' data.json
```

Count items by status:

```powershell
jq 'group_by(.status) | map({status: .[0].status, count: length})' data.json
```

## Reshaping

Project only selected fields:

```powershell
jq '.results[] | {id, name: .full_name, active: .is_active}' data.json
```

Merge two files:

```powershell
jq -s '.[0] * .[1]' base.json override.json
```

Flatten nested arrays:

```powershell
jq '.items | flatten' data.json
```

## Output control

Raw strings:

```powershell
jq -r '.message' data.json
```

Compact JSON:

```powershell
jq -c '.items[]' data.json
```

CSV output:

```powershell
jq -r '.items[] | [.name, .age, .email] | @csv' data.json
```

## Safe rewrite pattern

Do not rely on Unix tools such as `sponge`. Use a temporary file:

```powershell
$tmp = Join-Path $env:TEMP 'data.json.tmp'
jq '.settings.timeout = 30' config.json > $tmp
Move-Item $tmp config.json -Force
```

## Troubleshooting

Validate JSON syntax:

```powershell
jq empty data.json
```

Show all scalar values while exploring shape:

```powershell
jq '.. | scalars' data.json
```

Check a field type:

```powershell
jq '.field | type' data.json
```

If quoting becomes awkward, move the comparison value into `--arg` instead of embedding it directly in the jq program.
