#!/usr/bin/env pwsh
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$TargetSkillsDir
)

$ErrorActionPreference = "Stop"

function Show-Usage {
    @"
Usage: .\tools\install.ps1 <target-skills-dir>

Copies all Lattice skills into <target-skills-dir>, flattening the
atoms/molecules/refiners structure so your AI tool can discover them.

The target is the skills directory of your AI tool, for example:
  Claude Code:  ~/.claude/skills/  or  /path/to/project/.claude/skills/
  Cursor:       /path/to/project/.cursor/skills/
  Any other:    /absolute/path/to/your/skills/folder/

Examples:
  .\tools\install.ps1 ~/.claude/skills
  .\tools\install.ps1 C:\path\to\my-app\.claude\skills
  .\tools\install.ps1 C:\path\to\my-app\.cursor\skills
"@ | Write-Host
    exit 1
}

if ([string]::IsNullOrWhiteSpace($TargetSkillsDir)) {
    Show-Usage
}

$latticeDir = Split-Path -Parent $PSScriptRoot
$skillsSource = Join-Path $latticeDir "skills"

$destinationItem = New-Item -ItemType Directory -Path $TargetSkillsDir -Force
$destinationPath = $destinationItem.FullName

$count = 0
foreach ($tier in @("atoms", "molecules", "refiners")) {
    $tierDir = Join-Path $skillsSource $tier
    if (-not (Test-Path -LiteralPath $tierDir -PathType Container)) {
        continue
    }

    foreach ($skillDir in Get-ChildItem -LiteralPath $tierDir -Directory) {
        $skillName = $skillDir.Name
        $targetDir = Join-Path $destinationPath $skillName

        if (Test-Path -LiteralPath $targetDir -PathType Container) {
            Write-Host ("  update: {0}" -f $skillName)
            Remove-Item -LiteralPath $targetDir -Recurse -Force
        }
        else {
            Write-Host ("  add:    {0}" -f $skillName)
        }

        Copy-Item -LiteralPath $skillDir.FullName -Destination $targetDir -Recurse
        $count++
    }
}

Write-Host ""
Write-Host ("Installed {0} skills into {1}" -f $count, $destinationPath)
