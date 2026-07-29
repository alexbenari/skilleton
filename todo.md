- skill eval
    - cr over the clip-sandbox codebase
    - eval spec
- skill comparison
- typescript coding skill
    - test vs just with general coding skills -> generalize this testing to testing new skills
- inside skills, perhaps add a folder for yet untested skills?
- implement skill update flow properly
- update with new skills from mail
- Is plans.md needed? : In other/agents.md, there is a planning flow section and the reference to plans.md inside it which seem to overlap the spec+plan flow in superpowers. Check whether the two can be folded together and setup can be simplified, removing plans.md and possibly the planning flow section as well.
- Flow for setting up a new project: 
    - agents.md, plan.md and anything else non-skill (`other` folder)
    - skill packs? E.g. code-quality pack, per language pack
    - make into a cli
- Add llm-code related skill or agents.md section based on future additions.md
- Add guidance about testing with mocks
- Add the principle of designing logic to fail fast
- Remove the legacy Python CLI from skill-manager as part of the Electron-native SQLite migration (completed 2026-06-30)
- Add skill for writing learning docs
    - whenver a formula is introduced, explain each of its components in words and give an intuition for what the formula does, where it fits in the general scheme of things (if relevant) and how it is computed in practice (if not straightforwad)
    - when creating diagrams, make it easy to edit them in the future (e.g. by maintaining an editable source file for pngs)
    - TOC
    - Adding new content
        - Where to add? Review the document structure to locate the best insertion point for the new material. The goal is to maintain a logical flow. Reason about the options and pick the best one. 
        - How to add? The options are 1. a new section 2. merge into an existing section 3. a deeper structure change: merging/splitting one or more sections to create a new structure which accomodates the new content more naturally. This option can happen when the new content broadens the scope of the document, changes its focus or changes the point of view or emphasis of the document. 
        - Share your decisions on where to add and how to add as part of the summary you produce at the end and also as part of your reasoning trace.
    - review guideline: asses for each section how well its length reflects its relative importance in the doc. A subsection which takes a large portion of the document is a "smell" that needs to be surfaced to the user. It may sugget that the section is too detailed or that the focus of the document is wrong or poorly reflected.


review flow -> Suggest/surface:
factual correctness issues
duplications
sections which are too terse and should be expanded
places that could benefit from adding intuition for clarity
structure: is the document flow clear and logical? Are the section-subsection relationships clear? Are there sections that should actually be subsections? 
Any other comment or suggestion that can make this document a long-lasting, self contained referenced that will help me come back to the topic any time and quickly kickstart my understanding