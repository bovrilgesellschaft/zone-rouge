/** Loads /content from disk for scripts and tests. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Content, loadContent } from '../src/engine/content.js';

export function contentFromDisk(root = new URL('..', import.meta.url).pathname): Content {
  const dir = join(root, 'content');
  const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => /\.ya?ml$/.test(f));
  return loadContent(Object.fromEntries(files.map((f) => [f.replace(/\\/g, '/'), readFileSync(join(dir, f), 'utf8')])));
}
