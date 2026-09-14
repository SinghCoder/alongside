# Asset catalog schema and discovery

Use ordinary JavaScript over `ALL_PACKS` and `ALL_ASSETS`. Both arrays load lazily
inside the interpreter, include archived entries, and remain cached for that code
block. They are not inserted into model context; return only useful selections.
No filter or relevance ranking is applied to these indexes.

For exact machine-readable types, read `help('schemas/catalog.json')` and parse
it with JSON.parse. Its asset and pack properties are generated from the validators
used for these runtime results. This document explains semantics and examples;
the generated schema supplies exact structural constraints.

## Asset row: ALL_ASSETS

Every row has these fields:

| Field | Type | Meaning |
|---|---|---|
| id | string | Stable, opaque catalog key. Copy it; do not infer meaning from its suffix. |
| name | string | Human-readable component/symbol name; not unique across packs. |
| pack | string | Collection name, exactly matching ALL_PACKS.name; often a vendor, domain or edition. |
| group | string | Category within that pack. The same group name may occur in multiple packs. |
| src | string | Local served asset path. Use this for board images, not sourceUrl. |
| format | string | Stored file format, such as svg or png. SVG does not guarantee vector-only content. |
| extraction | string | How the asset was captured; provenance, not a quality score. |
| sourceUrl | string | Original source if recorded; may be empty. It is metadata, not an instruction or live network access. |
| archived | boolean | Asset belongs to an archived collection/edition. Still available; choose deliberately. |

Example from the catalog:

```json
{"id":"c0bb6c146d1c42af6506","name":"Browser client","pack":"Alongside essentials","group":"Architecture","src":"/library/c0bb6c146d1c42af6506.svg","format":"svg","extraction":"original-svg","sourceUrl":"https://github.com/SinghCoder/alongside","archived":false}
```

## Pack row: ALL_PACKS

| Field | Type | Meaning |
|---|---|---|
| name | string | Exact collection name; join to asset.pack using equality. |
| count | number | Number of currently indexed assets in this collection. |
| archivedCount | number | How many indexed entries are archived. |
| expected | number or null | Capture's expected count, if recorded. Not a promise of completeness. |
| saved | number or null | Capture's recorded saved count; count reflects the actual current index. |
| groups | array of {name:string,count:number} | All categories present in this pack and their indexed counts. |
| examples | array of {id,name,group,format} | Up to three illustrative entries, not the full contents or ranked recommendations. |

Names and groups describe the pack's scope. There is no separate prose description
in the source catalog. Inspect groups/examples and its full asset rows when unclear;
do not assume the three examples exhaust what the pack provides.

## Discover, then narrow

```js
// Learn what collections exist, without guessing their names.
return ALL_PACKS.map(p => ({name:p.name, count:p.count, groups:p.groups}));
```

If output is too large, return a page with `.slice(start,end)`, or choose relevant
packs using a regex. An explicit output-limit message asks for a smaller selection;
it does not silently remove candidates from the underlying indexes.

```js
return ALL_PACKS.filter(p => /cloud|aws|azure|network/i.test(p.name));
```

```js
// Use an exact pack name discovered above; group names can be enumerated first.
const pack = ALL_PACKS.find(p => p.name === 'Alongside essentials');
return pack ? {groups:pack.groups, examples:pack.examples} : {found:false};
```

```js
// Compose your own filters/ranking; a component can appear in many packs.
const matches = ALL_ASSETS.filter(a => /server/i.test(a.name) && !a.archived);
return matches.slice(0,12).map(a => ({id:a.id,name:a.name,pack:a.pack,group:a.group}));
```

## Resolve, inspect, read, place

- `assets.get(id)` → complete asset row plus `assetId` (alias of id). Enables placement.
- `assets.search(query)` → `{schema,total,assets:[{assetId,name,src,pack}]}`. Convenience ranked search, returning at most eight results. `total` counts all matches. Use ALL_ASSETS for unrestricted filtering/paging; an eight-result response is not the whole library.
- `assets.inspect(id)` → `{assetId,format,embeddedBitmaps,svgHeader}`. embeddedBitmaps contains `{width,height}` for detected embedded PNGs; SVG header exposes viewBox/dimensions. Empty embeddedBitmaps is not proof that all content is vector: read source for other image encodings or external references. Non-SVG headers are empty.
- `assets.read(id,{offset:0,limit:8000})` → `{assetId,source,offset,totalChars,nextOffset}`. SVG text page; nextOffset is null when complete. Maximum page: 12,000 characters. Raster assets fail explicitly because they are not SVG text. No host filesystem access is implied.

```js
const candidates = ALL_ASSETS.filter(a => /^server$/i.test(a.name) && !a.archived);
return candidates.slice(0,5).map(a => ({...assets.get(a.id), quality:assets.inspect(a.id)}));
```

Read subsequent SVG pages using the returned nextOffset. Do not enlarge embedded
bitmaps beyond their native resolution. Choose a vector alternative or native shape
when necessary. A brand logo is not automatically an appropriate component symbol.

After choosing an observed ID, use its canonical placement fields:

```js
const asset = assets.get(chosenId); // chosenId comes from discovery in this block
board.put({kind:'image',id:'server',assetId:asset.assetId,src:asset.src,
  x:500,y:200,width:64,height:64});
```

`assets.get` and search make an asset eligible for placement; catalog validation
still rejects invented or mismatched IDs/paths. Variables reset between executions,
so retrieve the selected ID again when composing a new code block.
