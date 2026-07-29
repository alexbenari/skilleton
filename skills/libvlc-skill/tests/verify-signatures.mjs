/**
 * Verify the libvlc skill reference structure.
 *
 * This intentionally does not compare the skill against every upstream
 * libvlc signature. The skill is a durable field guide; exact signatures
 * should be checked against the user's installed headers, binding docs, or
 * official VideoLAN docs/source for the target version.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(__dirname, "..", "skills", "libvlc");

const REQUIRED_FILES = [
  "SKILL.md",
  "references/core.md",
  "references/api-reference.md",
  "references/bindings.md",
  "references/workflows.md",
  "references/platforms.md",
  "references/migration.md",
];

const REQUIRED_SKILL_ANCHORS = [
  "references/core.md",
  "references/api-reference.md",
  "references/bindings.md",
  "references/workflows.md",
  "references/platforms.md",
  "references/migration.md",
  "verify exact signatures",
  "current headers",
];

const FILE_ANCHORS = {
  "references/core.md": [
    "Architecture Overview",
    "Core Concepts",
    "NEVER call any libvlc function from within a libvlc event callback",
    "Create exactly ONE `libvlc_instance_t`",
  ],
  "references/api-reference.md": [
    "API Reference by Domain",
    "canonical signature source",
    "official VideoLAN",
    "current headers",
  ],
  "references/bindings.md": [
    "Language Binding Patterns",
    "Available Language Bindings",
  ],
  "references/workflows.md": [
    "Common Workflows",
    "Troubleshooting",
    "CLI Options",
    "Deprecated API",
    "libvlc_media_add_option",
  ],
  "references/platforms.md": [
    "Platform Integration",
    "Windows",
    "macOS",
    "Linux",
    "Android",
  ],
  "references/migration.md": [
    "Migration Guide",
    "3.x",
    "4.x",
    "current headers",
  ],
};

async function readRelative(file) {
  return readFile(resolve(SKILL_ROOT, file), "utf-8");
}

function missingAnchors(text, anchors) {
  return anchors.filter((anchor) => !text.includes(anchor));
}

async function main() {
  console.log("=== libvlc-skill Reference Structure Verification ===\n");

  const errors = [];
  const loaded = new Map();

  for (const file of REQUIRED_FILES) {
    try {
      loaded.set(file, await readRelative(file));
      console.log(`  OK: ${file}`);
    } catch (error) {
      errors.push(`${file} is missing or unreadable: ${error.message}`);
    }
  }

  const skillText = loaded.get("SKILL.md");
  if (skillText) {
    for (const anchor of missingAnchors(skillText, REQUIRED_SKILL_ANCHORS)) {
      errors.push(`SKILL.md is missing routing/guidance anchor: ${anchor}`);
    }
  }

  for (const [file, anchors] of Object.entries(FILE_ANCHORS)) {
    const text = loaded.get(file);
    if (!text) continue;

    for (const anchor of missingAnchors(text, anchors)) {
      errors.push(`${file} is missing anchor: ${anchor}`);
    }
  }

  console.log("\nSummary");
  console.log(`  Files checked: ${loaded.size}/${REQUIRED_FILES.length}`);
  console.log(`  Errors: ${errors.length}`);

  if (errors.length > 0) {
    console.log("\nErrors:");
    errors.forEach((error) => console.log(`  ERROR: ${error}`));
    process.exit(1);
  }

  console.log("\nResult: PASS");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(2);
});
