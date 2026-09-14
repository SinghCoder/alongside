import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupLibrary } from './setup.mjs';

test('fresh installs include symbols and preserve an existing catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alongside-setup-'));
  try {
    await setupLibrary(root);
    const path = join(root, 'public/library/catalog.json');
    const catalog = JSON.parse(await readFile(path, 'utf8'));
    assert.ok(catalog.assets.some(asset => asset.name.includes('Database')));
    for (const asset of catalog.assets) {
      assert.match(await readFile(join(root, 'public', asset.src), 'utf8'), /<svg/);
    }
    const existing = '{"version":9,"assets":[]}';
    await writeFile(path, existing);
    await setupLibrary(root);
    assert.equal(await readFile(path, 'utf8'), existing);
  } finally { await rm(root, { recursive: true, force: true }); }
});
