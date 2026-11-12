/**
 * Loads content YAML into an index the engine reads from. The same code
 * runs in the browser (files bundled by Vite) and in Node (files read
 * from disk), so tests and the game see identical content.
 */
import { parse } from 'yaml';
import { z } from 'zod';
import { CONTENT_KINDS, type ContentKind, NodeTemplate, Start } from '../schema/content.js';

type Out<K extends ContentKind> = z.output<(typeof CONTENT_KINDS)[K]['schema']>;

export type ItemDef = Out<'items'>;
export type LootDef = Out<'loot'>;
export type NodeDef = Out<'nodes'>;
export type RegionDef = Out<'regions'>;
export type StartDef = z.output<typeof Start>;

export interface Content {
  all: { [K in ContentKind]: Out<K>[] };
  items: Map<string, ItemDef>;
  loot: Map<string, LootDef>;
  nodes: Map<string, NodeDef>;
  regions: Map<number, RegionDef>;
  start: StartDef;
}

/**
 * @param files content path relative to /content (e.g. `items/found.yaml`) → file text
 */
export function loadContent(files: Record<string, string>): Content {
  const all = Object.fromEntries(Object.keys(CONTENT_KINDS).map((k) => [k, []])) as unknown as Content['all'];
  let start: StartDef | undefined;

  for (const [rawPath, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const path = rawPath.replace(/\\/g, '/');
    const doc = parse(text);
    if (path === 'start.yaml') {
      start = Start.parse(doc);
      continue;
    }
    const kind = path.split('/')[0] as ContentKind;
    const spec = CONTENT_KINDS[kind];
    if (!spec) throw new Error(`content/${path}: unknown content folder`);
    for (const raw of (doc ?? []) as unknown[]) {
      const r = spec.schema.safeParse(raw);
      if (!r.success) throw new Error(`content/${path}: ${(raw as any)?.id ?? 'record'} is invalid. Run npm run validate.`);
      (all[kind] as unknown[]).push(r.data);
    }
  }
  if (!start) throw new Error('content/start.yaml is missing');

  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  return {
    all,
    items: byId(all.items),
    loot: byId(all.loot),
    nodes: byId(all.nodes),
    regions: new Map(all.regions.map((r) => [r.number, r])),
    start,
  };
}

// ---------------------------------------------------------------- placeholders

/**
 * Regions without written node templates get a placeholder place, so the
 * whole walk can be played before the content exists. Its id encodes the
 * region, so it never needs storing.
 */
export function placeholderNode(id: string, content: Content): NodeDef {
  const quay = id === 'node.placeholder.quay';
  const r = quay ? 7 : Number(id.match(/r(\d)$/)?.[1] ?? 1);
  const region = content.regions.get(r)?.name ?? `region ${r}`;
  return NodeTemplate.parse({
    id,
    kind: quay ? 'quay' : 'hamlet',
    regions: [r],
    terrain: quay ? 'road' : 'field',
    glance: quay
      ? '[The quay. The Crossing will end the run here.]'
      : `[A place in ${region}. No node templates are written for this region yet.]`,
    inspect: '[A proper look. Placeholder.]',
    pois: [{ key: 'house', label: 'A house.', loot: 'loot.placeholder_house', shelter: { quality: 2 } }],
  });
}

export function templateOf(content: Content, id: string): NodeDef {
  if (id.startsWith('node.placeholder.')) return placeholderNode(id, content);
  const t = content.nodes.get(id);
  if (!t) throw new Error(`no node template ${id}`);
  return t;
}

export function itemOf(content: Content, id: string): ItemDef {
  const t = content.items.get(id);
  if (!t) throw new Error(`no item ${id}`);
  return t;
}
