# Lesson document API

One conversation, multiple persistent drawing pages. Existing lessons open as
`start`. Inspect `document.list()` before choosing IDs. `board` always operates
on the active page. IDs are lowercase letters, digits, hyphens or underscores,
starting with a letter, at most 40 characters. Titles: 1–120 characters.

In the shell: `import {document, board} from '/opt/lesson/board.mjs'`.
All shell calls are async. QuickJS exposes the same methods synchronously.

- `document.list()` returns `{activeId, pages:[{id,title,parentId?,objects}]}`.
- `document.read(id)` adds `{page:{id,title,snapshot}}` without switching pages.
- `document.copy(id,title,from?)` copies a saved page and opens the copy. Defaults
  to the current page. Includes exact native elements, images, handwritten notes
  and viewport. Object IDs stay stable within each page. Copies are independent.
- `document.create(id,title)` opens a new blank page.
- `document.open(id)` opens an existing page and restores its exact contents.
- `document.rename(id,title)` changes a page title.

Present or discard your draft before switching/copying. A document operation
saves immediately; it is not a draft operation. Calls return after browser save.
A page switch has no eraser or drawing animation; subsequent board.present calls
animate only that page's changes. User navigation is disabled during your turn.
Up to 30 pages per lesson. Duplicate IDs and unknown source IDs are errors.
Generated operation schema: schemas/document.json (shell:
/opt/lesson/docs/schemas-document.json).

Choose a sequence that preserves useful explanations. For a next stage or
alternative, copy the starting page and add the difference. For a correction,
edit the page. Read, inspect and capture each page as needed; earlier screenshots
and tool results may be outdated. Keep steps small enough to read at their zoom.
