# Report Builder Requirements

PLACEHOLDER. This document exists so the evaluation loop can be exercised end
to end. Replace it with the real requirements document before running an
evaluation whose result you intend to act on, and keep the `R<n>.` numbering,
which the traceability check keys on.

## Purpose

A command-line executable that generates a Word document from a set of
parameters. The parameters express layout and content constraints that the
program must resolve into a single coherent document.

## Functional requirements

R1. The program accepts `--title <text>` and places it as the document's first
heading.

R2. The program accepts `--section <heading>:<body>` zero or more times, and
emits each as a heading followed by its body paragraph, in the order given.

R3. The program accepts `--output <path>` and writes the generated document
there. The path's parent directory is created if it does not exist.

R4. The program accepts `--page-size <a4|letter>`, defaulting to `a4`, and sets
the document's page size accordingly.

R5. The program accepts `--max-sections <n>`. When more sections are supplied
than `n` allows, the program exits non-zero with a message naming the limit and
the count supplied, and writes no document.

R6. The program accepts `--toc` and, when present, emits a table of contents
listing every section heading in order, placed after the title and before the
first section.

R7. `--title` and `--output` are required. Omitting either exits non-zero with
a message naming the missing parameter.

R8. A section whose body is empty is rejected before any document is written,
with a message naming the offending heading.

## Constraint interaction

R9. `--toc` combined with `--max-sections 0` is a contradiction: a table of
contents is requested for a document that may hold no sections. The program
exits non-zero and explains the conflict rather than emitting an empty table.

R10. The exit code is 0 only when a document was written.

## Out of scope

Styling beyond page size, images, tables, footnotes, and any interactive mode.
