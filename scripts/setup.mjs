import { cp, mkdir, stat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/starter-library');

export async function setupLibrary(root) {
  const target = join(root, 'public/library');
  const catalog = await stat(join(target, 'catalog.json')).catch(error => {
    if (error.code === 'ENOENT') { return null; }
    throw error;
  });
  if (catalog) { return; }

  // Bootstrap clean checkouts without replacing a user's imported library.
  await mkdir(target, { recursive: true });
  await cp(SOURCE, target, { recursive: true, force: false });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await setupLibrary(process.cwd());
  console.log('Symbol library ready. Existing catalogs are preserved.');
}
