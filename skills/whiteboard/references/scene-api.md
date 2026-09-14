# Scene API

All SDK calls are synchronous from your JavaScript. The host pauses execution when waiting for measurements or visible playback. Use loops, variables, functions, arrays, and Math normally. Each execute call has fresh local variables; the board workspace persists for the question. Return a compact useful result. To read documentation, use `return help(path)` or return an object containing its contents; calling help and discarding its value does not show you the reference.

## Inspect and discover

- `board.snapshot()` → `{revision, scene, notes, annotations, userMovedIds}` for the current draft.
- `board.capture()` renders the unpublished draft, including user annotations, as a PNG. Return from this execution to receive the image as native visual input; it is not exposed as base64 in JavaScript. Review the image in your next execution, then revise or present. Limit: 12 captures per question.
- `board.get(id)` → one draft object; unknown IDs throw.
- `board.inspect()` → `{revision, objects, bounds, diagnostics, notes, annotations}`. Bounds are calculated by the browser's actual renderer, including font metrics. Diagnostics report object overlaps, arrow intersections, and objects outside the teaching frame. They are evidence, not automatic layout commands.
- `help('references/scene-api.md')` → this document.
- `assets.search('short component name')` → `{total, assets:[{assetId,name,src,pack}]}`. Try another query if needed; never invent asset IDs or paths.
- `assets.inspect(assetId)` → format, SVG header, and embedded bitmap dimensions. Avoid enlarging tiny bitmaps; choose another asset when practical.

`annotations` contains read-only metadata for user-created elements: IDs, types,
geometry, rotation, groups, colors, text, path points and image file IDs as applicable.
These are not omitted when they are outside the teaching frame. Use them as spatial
context. The `scene` contains SDK-owned editable objects; put/patch/remove do not
edit user-created annotations. Draft captures include their visible appearance.
`userMovedIds` identifies user-adjusted placements; preserve these unless asked to change them. `notes` is a compact text summary; `annotations`
retains all user text entries. Request size limits fail explicitly rather than
silently dropping annotations.

## Asset catalog

Read `help('references/asset-catalog.md')` before using `ALL_PACKS`, `ALL_ASSETS`,
or the asset SDK. That reference defines every field, pack/group relationships,
return schemas, discovery examples, and SVG source pagination. `help()` lists
all available documents with descriptions. Indexes load lazily inside JavaScript;
only values you return enter model context.

For the exact accepted object schema, use `JSON.parse(help('schemas/board.json'))`.
It is generated from the runtime validator, including enum values and numeric limits.

## Create and revise

`board.put(object)` adds or replaces a draft object with a stable semantic ID.
`board.patch(id, changes)` updates named properties. `board.remove(id)` removes an object and its attached arrows. `board.discard()` restores the last published state.

All objects accept optional `group`: a semantic ID shared by a component icon and its label. Native selection and movement treat that component as a group. Do not group the entire diagram.

Object IDs: lowercase letter followed by letters, digits, hyphens or underscores; at most 40 characters.
Coordinates: canvas units, x right, y down. Comfortable teaching area: x30..790, y30..650. Font sizes 16..30. Read actual text measurements before packing a layout tightly. Nothing silently relocates your objects.

```js
// Node
board.put({kind:'node', id:'source', text:'Source', x:60, y:180,
  width:140, height:80, tone:'neutral'}); // tone: neutral, green, amber
// Text, independently editable
board.put({kind:'text', id:'title', text:'One idea at a time', x:60, y:40, size:26});
// Image: copy assetId and src from assets.search results
// {kind:'image', id:'server', assetId, src, x:450, y:180, width:64, height:64}
// Path: points are RELATIVE to x/y; can approximate curves with sampled points
// {kind:'path', id:'curve', x:40, y:100, points:[{x:0,y:0},{x:40,y:20},{x:80,y:0}]}
```

Add node/image endpoints before a connector. Arrows connect nodes or images (not text or paths).

```js
board.put({kind:'arrow', id:'flow', from:'source', to:'target',
  fromAnchor:'bottom', toAnchor:'left', via:[{x:130,y:350}]});
```

Anchor sides: left, right, top, bottom. Defaults: right → left. Optional `via` points use ABSOLUTE canvas coordinates. Choose anchors and bends to communicate the relationship and avoid labels. Do not assume every relationship belongs on one horizontal line.

## Present a teaching contribution

`board.present('One causal fact explained here.')` publishes draft changes and pauses THIS code block until the pen/image/text animation finishes. It returns current objects, notes, revision, and diagnostics. A call can contain a few related objects; keep each step small. Previously published objects remain editable.

```js
board.put({kind:'node', id:'first', text:'First', x:60,y:180,width:140,height:80,tone:'neutral'});
board.inspect();
board.present('A request starts here.');
// This line runs only after the first contribution finishes.
const first = board.get('first'); // incorporates user movement during playback
board.put({kind:'node', id:'second', text:'Second', x:first.x+320,y:first.y,width:140,height:80,tone:'neutral'});
board.present('The destination receives the request.');
board.put({kind:'arrow', id:'request', from:'first',to:'second'});
return board.present('This connection carries the request.');
```

A stale-board error means the user changed the board since your last presentation. No pending contribution is applied, and the draft resets to actual state. Read it and adapt. On errors, already published steps remain; unpublished changes can be discarded.

Limits: 80 objects, 16 presentations per question. Execution has memory and CPU limits. The bridge also limits total calls. Finish the explanation before exhausting the budget.
