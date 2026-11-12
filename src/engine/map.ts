/**
 * PROVISIONAL map generator for the skeleton. The real one (fixed
 * landmarks, roads, rivers, hot spots placed downwind) is built with the
 * vertical slice. This one only has to give him somewhere to walk.
 *
 * Shape: each region is three or four columns of one to three places,
 * running east to west. Every place links to one or two places in the
 * next column west, sometimes to a neighbour in its own column, and all
 * links can be walked both ways. The cabin is first; the quay is last.
 */
import type { z } from 'zod';
import type { RunState } from '../schema/run-state.js';
import { type Content, type NodeDef, templateOf } from './content.js';
import type { Rng } from './rng.js';

type Nodes = RunState['nodes'];
type NodeInstance = Nodes[string];
type Terrain = z.output<typeof import('../schema/common.js').Terrain>;

export const HOURS: Record<Terrain, number> = { road: 2, field: 3, forest: 4, rubble: 4 };

export function generateMap(rng: Rng, content: Content): { nodes: Nodes; start: string } {
  const nodes: Nodes = {};
  let next = 0;

  const make = (template: NodeDef, region: number): string => {
    const id = `n${next++}`;
    const hotspots = content.regions.get(region)?.hotspots ?? 0.1;
    nodes[id] = {
      id,
      template: template.id,
      region,
      links: [],
      known: 'unknown',
      inspected: false,
      searched: {},
      cache: [],
      doseRate: rng.chance(hotspots) ? 0.2 + rng.next() * 2 : rng.next() * 0.02,
    };
    return id;
  };

  const pool = (region: number): NodeDef[] =>
    [...content.nodes.values()].filter((t) => !t.landmark && t.kind !== 'cabin' && t.regions.includes(region));

  const pick = (region: number): NodeDef => {
    const p = pool(region);
    return p.length ? rng.weighted(p, (t) => t.weight) : templateOf(content, `node.placeholder.r${region}`);
  };

  const link = (a: string, b: string) => {
    const A = nodes[a]!;
    const B = nodes[b]!;
    if (a === b || A.links.some((l) => l.to === b)) return;
    const tb = templateOf(content, B.template).terrain;
    const ta = templateOf(content, A.template).terrain;
    A.links.push({ to: b, terrain: tb, hours: HOURS[tb] });
    B.links.push({ to: a, terrain: ta, hours: HOURS[ta] });
  };

  const connect = (from: string[], to: string[]) => {
    for (const a of from) for (const b of rng.sample(to, rng.int(1, Math.min(2, to.length)))) link(a, b);
    for (const b of to) if (!nodes[b]!.links.some((l) => from.includes(l.to))) link(rng.pick(from), b);
    for (let i = 0; i + 1 < to.length; i++) if (rng.chance(0.3)) link(to[i]!, to[i + 1]!);
  };

  const cabin = [...content.nodes.values()].find((t) => t.kind === 'cabin');
  if (!cabin) throw new Error('content has no cabin node');
  const start = make(cabin, 1);

  let column = [start];
  for (let region = 1; region <= 7; region++) {
    const columns = rng.int(3, 4);
    for (let c = 0; c < columns; c++) {
      const width = rng.int(1, 3);
      const col = Array.from({ length: width }, () => make(pick(region), region));
      connect(column, col);
      column = col;
    }
  }
  const quay = make(templateOf(content, 'node.placeholder.quay'), 7);
  connect(column, [quay]);

  return { nodes, start };
}

/** He can see the places next to where he stands. */
export function revealAround(nodes: Nodes, at: string): void {
  const here = nodes[at] as NodeInstance;
  here.known = 'visited';
  for (const l of here.links) {
    const n = nodes[l.to]!;
    if (n.known === 'unknown' || n.known === 'mapped') n.known = 'seen';
  }
}
