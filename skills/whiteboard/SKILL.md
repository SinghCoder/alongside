---
name: whiteboard
description: Explain ideas collaboratively using an editable whiteboard, reference images, local symbols, and interactive JavaScript drawing steps.
---

# Working on the shared board

Use `execute_whiteboard` to run JavaScript against the board SDK.
Only the value you return becomes tool output. Calling `help(path)` without
returning or including its contents does not let you read the document.

```js
return { sdk: help('references/scene-api.md'), board: board.snapshot() };
```

Choose native drawing, library symbols, existing diagrams/images, or combinations
based on the user's task. When asked to take, use or explain an existing visual,
find and inspect that visual unless it is already supplied or on the board.
Do not silently replace that task with drawing your own simplified version.
For a new explanation, choose whichever representation communicates it best.

Read only the references needed for that choice:
- `return help('references/web-images.md')` for finding/importing diagrams or images.
- `return help('references/asset-catalog.md')` for symbol library schemas and discovery.
- `return help()` to discover all references.

## Workflow

1. Read the current objects, notes, and question. Choose a small explanation.
2. Gather the visual material you need. Image search can find technical figures and architecture diagrams as well as photos. For library assets, ALL_ASSETS and ALL_PACKS support free JavaScript filtering; assets.search is a convenience. Inspect selected material for relevance and legibility. Do not enlarge tiny bitmaps when clearer alternatives are available.
3. Use code to construct or revise a draft. Coordinates and relationships are your decisions.
4. Call `board.inspect()` for actual text bounds and intersection diagnostics. Correct unintended issues; intentional intersections may remain.
5. Capture the draft with `return board.capture()` and end the execution. You receive a rendered image in the tool result. Review it in the next execution before publishing: check spacing, nearby captions, readable arrows and causal correctness. Revise and recapture meaningful layout changes.
6. Call `board.present(caption)` to publish one teaching contribution. It blocks until drawing finishes, then returns actual board state, including user edits.
7. Continue in the same code block, or inspect results and write another block. End with a short takeaway and a relevant follow-up.

## Teaching

For a component walkthrough, choose a reading order after inspecting the visual.
Mark a component's actual location, explain its purpose and connections in the
caption, and call `board.present` before moving to the next component. Related
repeated components can be explained together. Keep the reference visible and
accumulate small annotations so the learner can revisit earlier points. A list
of component names presented all at once does not complete a walkthrough.
Plan space for these annotations before drawing them; simple text and open paths
are often enough. Intentional pointers/outlines on the image are not collisions
to remove merely to silence diagnostics.

Represent the mechanism visually: objects, paths, arrows, branches, containment, or spatial change. A row of prose-filled boxes is not enough. Use native paths and shapes for mechanisms that icons cannot express. The topic alone does not determine which tool to use.

Build understanding progressively: introduce an object, add a relationship, then extend the idea. An imported reference can appear whole; reveal its explanation progressively with callouts, pointers and open outlines around the relevant regions. Keep original labels readable, avoid opaque boxes over the image, and preserve the reference while discussing it. Cover the requested components and their relationships, not just their names. Captions explain causes, not drawing mechanics. Keep labels short; put the explanation in captions. Prefer an icon plus a nearby label over an icon plus a duplicate prose box. Give each component and its label the same `group`. Leave space for relationships; remove obsolete arrows instead of layering new ones on top. Check who initiates each operation, not merely the order of steps.

The user can pause and move objects. Read returned state before extending a published scene. `userMovedIds` identifies placements the user changed; preserve those while rearranging other objects as needed. Do not overwrite user placement merely to restore your preferred coordinates. After a stale-state error, the draft is discarded: inspect and adapt.

## Capabilities

Draft PNG captures through `board.capture()`, native groups, shapes, text, editable paths, local images, connectors with selectable sides and bends, patches, removal, renderer measurements, asset inspection, and reversible draft edits.

No browser DOM, network, host filesystem, imports, or arbitrary external execution is available inside the interpreter. Use `help` for the documented API. Code is JavaScript, not TypeScript. Do not use promises or async/await: SDK calls already wait synchronously inside the interpreter.

For multi-step explanations, read `references/document-api.md`. The document
preserves pages independently: copy a prior page for a new stage or alternative,
then continue drawing through `board`. Use board edits for corrections.
