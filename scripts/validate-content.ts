/**
 * Checks every content record before it can reach the game.
 *
 *   npm run validate
 *
 * Errors fail the check. Warnings are printed and let it pass.
 *
 * What it checks:
 *   - each record matches the schema for its folder
 *   - ids are unique and use the right prefix
 *   - every item, loot table and recipe named by a record exists
 *   - every uncanny event's rational shadow is planted by some other record
 *   - no tableau says tarot, arcana or card, or names its own card
 *   - the coins and the photograph are bound
 *   - the start record is sound
 *
 * The prose style linter (banned words, quotation marks, apostrophes,
 * sentence length) is a separate tool, due at Stage 6.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse } from 'yaml';
import type { ZodError } from 'zod';
import { CONTENT_KINDS, type ContentKind, Start } from '../src/schema/content.js';

/** Optional argument: another project root, for testing the checker itself. */
const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const CONTENT = join(ROOT, 'content');
const INK = join(ROOT, 'ink');

type Issue = { level: 'error' | 'warn'; where: string; message: string };
const issues: Issue[] = [];
const error = (where: string, message: string) => issues.push({ level: 'error', where, message });
const warn = (where: string, message: string) => issues.push({ level: 'warn', where, message });

type Loaded = { kind: ContentKind; file: string; record: any };
const records: Loaded[] = [];
const counts: Partial<Record<ContentKind, number>> = {};

const zodMessages = (e: ZodError) =>
  e.issues.map((i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`);

// ---------------------------------------------------------------- load

const files = (readdirSync(CONTENT, { recursive: true }) as string[])
  .filter((f) => /\.ya?ml$/.test(f))
  .sort();

let start: any;

for (const rel of files) {
  const path = join(CONTENT, rel);
  const shown = relative(ROOT, path);
  let doc: unknown;
  try {
    doc = parse(readFileSync(path, 'utf8'), { prettyErrors: true });
  } catch (e) {
    error(shown, `YAML will not parse: ${(e as Error).message}`);
    continue;
  }

  if (rel === 'start.yaml') {
    const r = Start.safeParse(doc);
    if (!r.success) zodMessages(r.error).forEach((m) => error(shown, m));
    else start = r.data;
    continue;
  }

  const folder = rel.split(sep)[0] as ContentKind;
  const kind = CONTENT_KINDS[folder];
  if (!kind) {
    error(shown, `no such content kind as "${folder}". Folders are: ${Object.keys(CONTENT_KINDS).join(', ')}`);
    continue;
  }
  if (doc == null) continue; // empty file
  if (!Array.isArray(doc)) {
    error(shown, 'a content file must be a list of records, each starting with "- id:"');
    continue;
  }

  doc.forEach((raw, i) => {
    const label = `${shown} [${(raw as any)?.id ?? `record ${i + 1}`}]`;
    const r = kind.schema.safeParse(raw);
    if (!r.success) {
      zodMessages(r.error).forEach((m) => error(label, m));
      return;
    }
    records.push({ kind: folder, file: shown, record: r.data });
    counts[folder] = (counts[folder] ?? 0) + 1;
  });
}

// ---------------------------------------------------------------- ids

const byId = new Map<string, Loaded>();
for (const l of records) {
  const prev = byId.get(l.record.id);
  if (prev) error(`${l.file} [${l.record.id}]`, `id already used in ${prev.file}`);
  else byId.set(l.record.id, l);
}
const exists = (prefix: string) => (id: string) => id.startsWith(prefix + '.') && byId.has(id);
const itemExists = exists('item');
const lootExists = exists('loot');
const recipeExists = exists('recipe');
const itemTags = new Set(records.filter((l) => l.kind === 'items').flatMap((l) => l.record.tags ?? []));

// ---------------------------------------------------------------- references

/** Walk any record and check every item/loot/recipe id it names. */
function checkRefs(where: string, value: unknown, key = ''): void {
  if (Array.isArray(value)) return value.forEach((v) => checkRefs(where, v, key));
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'notes' || k === 'id') continue;
      checkRefs(where, v, k);
    }
    return;
  }
  if (typeof value !== 'string') return;
  if (value.startsWith('item.') && !itemExists(value)) error(where, `${key}: no item called ${value}`);
  if (value.startsWith('loot.') && !lootExists(value)) error(where, `${key}: no loot table called ${value}`);
  if (value.startsWith('recipe.') && !recipeExists(value)) error(where, `${key}: no recipe called ${value}`);
}

for (const l of records) checkRefs(`${l.file} [${l.record.id}]`, l.record);
if (start) checkRefs('content/start.yaml', start);
else if (!files.includes('start.yaml')) error('content/start.yaml', 'missing: the game needs a starting state');

// Recipe ingredients given by tag must match at least one item's tags.
for (const l of records.filter((r) => r.kind === 'recipes')) {
  for (const ing of [...l.record.inputs, ...l.record.tools]) {
    if (ing.tag && !itemTags.has(ing.tag))
      error(`${l.file} [${l.record.id}]`, `no item carries the tag "${ing.tag}", so this recipe can never be made`);
  }
}

// ---------------------------------------------------------------- fixed decisions

for (const id of ['item.two_coins', 'item.photograph']) {
  const l = byId.get(id);
  if (!l) error('content/items', `${id} is missing. It is part of the fixed design`);
  else if (!l.record.bound) error(`${l.file} [${id}]`, 'must be bound: it can never be dropped, lost, traded or stolen');
}

// ---------------------------------------------------------------- shadows

const planted = new Map<string, string[]>();
for (const l of records) {
  const keys: string[] = [
    ...(l.record.plants ?? []),
    ...(l.record.pois ?? []).flatMap((p: any) => p.effects?.setFlags ?? []),
  ].filter((k) => k.startsWith('shadow.'));
  for (const k of keys) planted.set(k, [...(planted.get(k) ?? []), l.record.id]);
}
const shadowsNeeded = new Set<string>();
for (const l of records.filter((r) => r.kind === 'uncanny')) {
  const key = l.record.shadow.key as string;
  shadowsNeeded.add(key);
  const by = (planted.get(key) ?? []).filter((id) => id !== l.record.id);
  if (by.length === 0)
    error(`${l.file} [${l.record.id}]`, `its rational shadow ${key} is not planted anywhere. Add "plants: [${key}]" to the record that explains it`);
}
for (const [key, by] of planted)
  if (!shadowsNeeded.has(key)) warn(by.join(', '), `plants ${key}, but no uncanny event uses that shadow yet`);

// ---------------------------------------------------------------- tableaux

const proseOf = (p: unknown): string[] =>
  typeof p === 'string' ? [p] : p && typeof p === 'object' ? Object.values(p).flatMap(proseOf) : [];

for (const l of records.filter((r) => r.kind === 'tableaux')) {
  const where = `${l.file} [${l.record.id}]`;
  const text = proseOf(l.record.text).join('\n');
  const giveaway = text.match(/\b(tarot|arcana|arcanum|cards?)\b/i);
  if (giveaway) error(where, `the text says "${giveaway[0]}". A tableau is never named or hinted at`);
  const title = String(l.record.card).replace(/^The\s+/i, '');
  if (new RegExp(`\\b${title}\\b`).test(text))
    warn(where, `the text uses the card's own name "${title}" with a capital. Check it does not read as a wink`);
}

// ---------------------------------------------------------------- ink

for (const l of records.filter((r) => r.kind === 'encounters')) {
  const file = String(l.record.ink).split('#')[0]!;
  if (!existsSync(join(INK, file)))
    warn(`${l.file} [${l.record.id}]`, `ink file ink/${file} not written yet (due at Stage 5, encounters)`);
}

// ---------------------------------------------------------------- report

const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.filter((i) => i.level === 'warn');

for (const i of [...errors, ...warnings]) {
  const mark = i.level === 'error' ? 'ERROR' : 'warn ';
  console.log(`${mark}  ${i.where}\n       ${i.message}`);
}

const summary = Object.entries(counts)
  .map(([k, n]) => `${n} ${k}`)
  .join(', ');
console.log(`\n${records.length} records (${summary})${start ? ' and the start' : ''}.`);
console.log(`${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`);
process.exit(errors.length ? 1 : 0);
