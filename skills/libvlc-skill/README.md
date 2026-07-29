# libvlc-skill

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/mfkl/libvlc-skill/actions/workflows/verify-signatures.yml/badge.svg)](https://github.com/mfkl/libvlc-skill/actions)

A portable agent skill for **Claude Code** and **Codex** that gives AI coding assistants deep knowledge of the **libvlc** API (both **3.x** and **4.x**), the multimedia framework behind VLC media player.

## Why?

LLMs frequently hallucinate libvlc API details, confuse 3.x and 4.x behavior, and miss platform-specific integration patterns. This skill injects a structured, version-aware reference set into the LLM context and tells the agent when to verify exact signatures against current headers or official docs.

## Base Model vs With Skill

| Area | Base Assistant | With Skill |
|------|----------------|------------|
| libvlc 3.x basic API | Good general knowledge | Version-aware guidance plus header verification |
| libvlc 4.x API | Weak/incomplete | Curated guidance with explicit current-header checks |
| 3.x vs 4.x differences | Likely to confuse versions | Clear side-by-side with markers |
| Threading/deadlock rules | Knows the broad concept | Per-language solutions with correct patterns |
| Sout chain syntax | Approximate knowledge | Exact syntax with tested recipes |
| Platform embedding | General patterns | Full working samples from official VLC examples |
| LibVLCSharp specifics | General .NET patterns | Binding-aware usage and verification cues |
| Plugin discovery / `VLC_PLUGIN_PATH` | Likely incomplete | Detailed coverage from source code |
| Migration guidance | Spotty | Dedicated 3.x to 4.x migration map |

## How it works

The skill is a curated markdown reference set that Claude Code and Codex can load automatically when your prompt mentions libvlc-related keywords. Instead of one large file, the reference is split into focused files so the agent can load only the pieces it needs. The bundled API tables are guidance and examples; for exact function signatures, the skill instructs agents to check the target project's installed `<vlc/vlc.h>` headers, binding docs, or official VideoLAN source/docs.

**Trigger keywords**: `libvlc`, `libVLC`, `VLC SDK`, `LibVLCSharp`, `python-vlc`, `vlcj`, `vlcpp`, or any VLC-based media playback, streaming, or transcoding prompt.

## Reference layout

- `skills/libvlc/SKILL.md` - skill entrypoint and routing guidance
- `skills/libvlc/references/core.md` - architecture, lifecycle, threading, logging, plugin discovery
- `skills/libvlc/references/api-reference.md` - domain API guidance and curated signature examples
- `skills/libvlc/references/bindings.md` - language bindings and binding patterns
- `skills/libvlc/references/workflows.md` - recipes, streaming, troubleshooting, CLI options, deprecated APIs
- `skills/libvlc/references/platforms.md` - Windows, macOS, iOS, Linux, Qt, Android, Avalonia integration
- `skills/libvlc/references/migration.md` - 3.x to 4.x migration guide

## Usage example

Once installed, just ask naturally. The skill activates automatically:

```text
> Write a C# app that plays a video file with LibVLCSharp

> How do I select an audio track in libvlc 4.x?

> Convert my python-vlc 3.x code to 4.x
```

Claude Code or Codex will use the split reference set to load the relevant sections, generate version-aware code, and verify exact signatures against the target version when needed.

## Installation

**Claude Code skill install:**

Copy the `skills/libvlc/` folder into your Claude skills directory:

```bash
git clone https://github.com/mfkl/libvlc-skill.git
mkdir -p ~/.claude/skills/libvlc
cp -R ./libvlc-skill/skills/libvlc/* ~/.claude/skills/libvlc/
```

**Codex skill install:**

For a repo-scoped install:

```bash
git clone https://github.com/mfkl/libvlc-skill.git
mkdir -p .agents/skills/libvlc
cp -R ./libvlc-skill/skills/libvlc/* .agents/skills/libvlc/
```

For a user-level install:

```bash
git clone https://github.com/mfkl/libvlc-skill.git
mkdir -p ~/.agents/skills/libvlc
cp -R ./libvlc-skill/skills/libvlc/* ~/.agents/skills/libvlc/
```

**Optional Claude plugin compatibility:** This repo still includes `.claude-plugin/plugin.json` for setups that prefer Claude's plugin packaging, but the core artifact is the skill itself.

**Other tools:** Add the full `skills/libvlc/` folder to your project's context or skills directory so your AI assistant can reference the split files.

## Compatibility

This repository is primarily a portable agent skill. It works with [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Codex, and other tools that support the `SKILL.md` format or can load reference documents into context.

## Structure

```text
libvlc-skill/
├── .claude-plugin/
│   └── plugin.json              # Optional Claude plugin compatibility manifest
├── .github/
│   └── workflows/
│       └── verify-signatures.yml # CI to verify reference structure
├── skills/
│   └── libvlc/
│       ├── SKILL.md             # Skill entrypoint with routing guidance
│       └── references/
│           ├── api-reference.md
│           ├── bindings.md
│           ├── core.md
│           ├── migration.md
│           ├── platforms.md
│           └── workflows.md
└── README.md
```

## Version coverage

This skill covers both **libvlc 3.x** (VLC 3.0.x) and **libvlc 4.x**. Where APIs differ between versions, inline markers indicate which version applies:

- No marker: same in both versions
- `[3.x]`: only in libvlc 3.x
- `[4.x]`: new in libvlc 4.x
- `[4.x change]`: exists in both but the signature changed

## Related projects

- [LibVLCSharp](https://github.com/videolan/LibVLCSharp) - .NET and C# bindings for libvlc
- [python-vlc](https://github.com/oaubert/python-vlc) - Python bindings for libvlc
- [vlcj](https://github.com/caprica/vlcj) - Java bindings for libvlc
- [libvlcpp](https://code.videolan.org/videolan/libvlcpp) - C++ bindings for libvlc

## Contributing

PRs welcome, especially for new language binding examples, 4.x guidance, and platform-specific recipes. If you spot stale API guidance, please open an issue with the target libvlc version and source/header reference.

## License

MIT
