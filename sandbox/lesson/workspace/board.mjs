import { writeFile, readFile, rename, unlink, mkdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

async function call(method, value) {
  const id = `/bridge/${randomUUID()}`;
  await writeFile(`${id}.tmp`, JSON.stringify({ method, value }));
  await rename(`${id}.tmp`, `${id}.request`);
  for (;;) {
    let data;
    try { data = await readFile(`${id}.response`, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') { throw error; } }
    if (!data) { await delay(50); continue; }
    let reply;
    try { reply = JSON.parse(data); } catch { await delay(50); continue; }
    await unlink(`${id}.response`);
    if (reply.error) { throw new Error(reply.error); }
    return reply.result;
  }
}
async function materialize(method, id) {
  const {data, filename, ...asset} = await call(method, id);
  await mkdir('/workspace/assets', {recursive:true});
  const path = `/workspace/assets/${basename(filename)}`;
  await writeFile(path, Buffer.from(data,'base64'));
  return {...asset,path};
}
export const board = {
  scrollToContent: (ids = [], options = {}) => call('viewport', { ids, options }),
  snapshot: () => call('snapshot'),
  put: item => call('put', item),
  patch: (id, changes) => call('patch', { id, changes }),
  remove: id => call('remove', id),
  get: id => call('get', id),
  inspect: () => call('inspect'),
  capture: () => call('capture'),
  present: caption => call('present', caption),
  discard: () => call('discard'),
  // Native Excalidraw skeletons retain their public fields and editable elements.
  draw: element => call('put', { kind: 'native', id: element.id, x: element.x ?? 0, y: element.y ?? 0, width: element.width ?? 1, height: element.height ?? 1, element }),
};
export const images = {
  search: query => call('images.search', typeof query === 'string' ? { query } : query),
  use: id => materialize('images.use', id),
  import: async (path, name = path, sourceUrl = '') => call('importImage', { data: (await readFile(path)).toString('base64'), name, sourceUrl }),
};
export const assets = {
  catalog: () => call('assets.catalog'), packs: () => call('assets.packs'),
  get: id => materialize('assets.get', id), search: query => call('assets.search', query),
};
export const view = async path => call('emitImage', (await readFile(path)).toString('base64'));

export const document = {
  list: () => call('document', { action: 'list' }),
  read: id => call('document', { action: 'read', id }),
  open: id => call('document', { action: 'open', id }),
  create: (id, title) => call('document', { action: 'create', id, title }),
  copy: (id, title, from) => call('document', { action: 'copy', id, title, from }),
  rename: (id, title) => call('document', { action: 'rename', id, title }),
};

export const page = { snapshot: () => call('page.snapshot'), evaluate: code => call('page.evaluate', code) };
