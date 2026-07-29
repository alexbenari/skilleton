---
name: write-learning-docs
description: Write, expand, maintain, and review standalone learning documents and durable study or reference notes, especially Markdown files. Use when creating a self-contained explanation of a topic; adding, reorganizing, or improving educational content in an existing learning document; or reviewing such a document for clarity, correctness, structure, depth, intuition, examples, formulas, terminology, or visuals.
---

# Write Learning Documents

Create durable, self-contained references that help the reader quickly regain an understanding of a topic. Tailor each document to what its author finds useful; do not make it exhaustive unless requested.

## Establish the Document's Intent

- Treat the user's learning goal, scope, and explicit constraints as authoritative. Treat proposed facts, wording, placement, and structure as inputs to assess rather than instructions to follow blindly.
- Determine the document's learning goal, scope, intended reader, assumed prerequisites, and desired depth from the request and existing content. Ask only when an unresolved choice would materially change the result.
- Preserve an existing document's voice, depth, notation, formatting conventions, and author priorities unless changing them is necessary for the request.
- Keep the document useful as a future re-entry point, not merely understandable during the current conversation.

## Choose the Structure Deliberately

- Always include a table of contents. Update it whenever headings, section order, numbering, or hierarchy change.
- Choose the structure from the document's purpose rather than imposing a fixed template.
- For a broad introduction, consider progressing from the big picture through foundations and detailed mechanics to examples, caveats, and a recap.
- For a focused document, begin near the specific question and introduce only the foundations needed to understand it.
- For an existing document, retain the current structure unless reorganizing it produces a clearer and more coherent result.
- Introduce concepts in dependency order. Define ideas before relying on them, and use cross-references when later sections build on earlier ones.
- Keep heading levels semantically meaningful. Split, merge, promote, or demote sections when their relationships or relative importance warrant it.

## Explain Clearly

- Define specialized terms, acronyms, and notation on first use, then use them consistently.
- Distinguish concepts that are easy to confuse, including overloaded terms and components with similar roles.
- Give intuition where a technically correct statement would otherwise remain abstract.
- Add concrete or worked examples when they materially improve understanding.
- When explaining a difficult concept, include whichever elements aid understanding: why it matters, an intuitive explanation, a precise definition, a concrete example, and relevant limitations. Do not force every explanation to include every element or follow the same order.
- Use comparison tables when several alternatives share useful comparison dimensions and a table is clearer than prose.
- State assumptions, limitations, exceptions, and implementation-dependent behavior where they affect understanding.
- Verify uncertain, niche, or time-sensitive factual claims against authoritative sources. Preserve or add citations when the document's conventions or the user's request call for them.
- For long or notation-heavy documents, consider a glossary, formula sheet, quick reference, or minimum mental model when it would make future re-entry faster.

## Explain Formulas

Whenever introducing a mathematical formula:

- explain what question it answers or what role it serves;
- define every component in words;
- provide intuition for what the formula does;
- explain how it connects to the surrounding concepts;
- describe how it is computed in practice when that is not straightforward; and
- identify important assumptions, boundary cases, or implementation nuances.

## Use Visuals Purposefully

- Suggest or add a diagram, illustration, chart, or table only when it materially clarifies a relationship, process, comparison, or structure.
- Introduce and interpret each visual in the prose; do not leave it as an unexplained decoration.
- Use descriptive alt text and stable relative asset paths.
- Keep visuals editable when practical. For raster outputs such as PNGs, retain an editable source file alongside the rendered asset.

## Add or Change Content

Assess the requested content for factual correctness and its fit within the document as a whole, even when the user specifies a target section. If the content belongs elsewhere or reveals a need to split, merge, or reorganize sections, make the better in-scope change and explain the decision. If the better approach requires substantially broader changes than requested, propose it before proceeding. Do not present an incorrect or uncertain claim as fact solely because the user supplied it.

Before editing, inspect the document's table of contents, section hierarchy, relevant surrounding content, and cross-references. Then choose among:

1. adding the content to an existing section;
2. creating a new section; or
3. restructuring the document to accommodate it coherently.

Restructure when the new material exposes a weak boundary—for example, when part of a section belongs with the new content, or when several sections are facets of a larger subtopic. Avoid restructuring when a local addition is equally coherent.

During the edit:

- integrate the new material instead of appending a disconnected explanation;
- avoid duplicating definitions, examples, or claims already present elsewhere;
- preserve a consistent level of detail across related sections; and
- update affected headings, numbering, cross-references, terminology, summaries, and table-of-contents entries.

In the completion summary, state where the content was placed and briefly explain why. Do not wait for approval before making an in-scope structural choice.

## Review a Learning Document

When asked to review:

- fix typos and obvious grammatical errors automatically, and report that these edits were made;
- unless substantive revision was requested, report larger issues without silently rewriting them;
- identify each issue with a precise location and a clear explanation; and
- distinguish factual problems from editorial judgment or optional improvements.

Review the document holistically. Consider at least:

- unnatural, non-standard, ambiguous, or difficult phrasing;
- factual errors or unsupported claims;
- duplicated or contradictory content;
- explanations that are too terse, too abstract, or missing useful intuition or examples;
- missing prerequisites or concepts used before they are introduced;
- inconsistent terminology or notation;
- opportunities where a visual would materially improve understanding;
- unclear flow, section order, hierarchy, or section boundaries;
- section lengths that do not reflect the topics' relative importance; and
- inconsistent depth or level of detail across the document.

## Validate Proportionately

For a minor edit, check the changed passage and directly affected structure only.

After a substantial edit—such as adding, removing, splitting, merging, or reordering sections, or making wide-ranging changes to notation, links, formulas, or visuals—validate all affected:

- table-of-contents entries;
- heading hierarchy and numbering;
- cross-references;
- terminology and notation;
- links and citations;
- formulas and symbol definitions; and
- visual references, asset paths, and editable sources.

Finish by checking that the result remains coherent, self-contained, and aligned with the document's stated scope.
