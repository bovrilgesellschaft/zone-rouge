/**
 * The pack: what he carries, where, and what it costs him.
 *
 * Carrying is weight in kilograms, limited by what he carries it in:
 * pockets 3 kg, webbing 8, a rucksack 20, a pram 40 (roads only, noisy).
 * What he wears and holds is not counted against a container, but what
 * he carries on his body tires him once it passes a working load.
 *
 * The two coins and the photograph are bound: they cannot be dropped,
 * traded, spent or stolen. A looter who strips him leaves them.
 *
 * Tuning numbers are in PACK.
 */
import type { RunState } from '../schema/run-state.js';
import { nextUid } from './body.js';
import { type Content, type ItemDef, itemOf } from './content.js';
import type { Rng } from './rng.js';

export const PACK = {
  capacity: { pockets: 3, webbing: 8, rucksack: 20, cart: 40 },
  /** Things lighter than this go in his pockets first. */
  pocketable: 0.3,
  /** Kilograms on his body (not worn, not in the pram) he can carry without extra fatigue. */
  workingLoad: 12,
  /** Each kilogram over the working load adds this fraction to walking fatigue. */
  fatiguePerKgOver: 0.04,
  /** Boots lose this much condition per hour walked. */
  bootWearPerHour: 0.5,
  /** Below this condition, each walk may hurt his feet. */
  bootsGone: 25,
  footWoundChance: 0.15,
};

type Carried = RunState['pack'][number];
export type Container = keyof typeof PACK.capacity;
const ORDER: Container[] = ['pockets', 'webbing', 'rucksack', 'cart'];

// ================================================================ weight and room

export function weightOf(p: Carried, content: Content): number {
  const def = itemOf(content, p.item);
  const each = def.weight * (p.left ?? 1);
  return each * p.qty + (p.fill?.litres ?? 0);
}

/** The containers he has, and what each will hold. Pockets always. */
export function containers(state: RunState, content: Content): Partial<Record<Container, number>> {
  const out: Partial<Record<Container, number>> = { pockets: PACK.capacity.pockets };
  for (const p of state.pack) {
    const slot = itemOf(content, p.item).container?.slot;
    if (slot && slot !== 'pockets') out[slot] = PACK.capacity[slot];
  }
  return out;
}

export function loadIn(state: RunState, content: Content, where: Container): number {
  return state.pack
    .filter((p) => p.where === where && !isContainerItself(p, content))
    .reduce((n, p) => n + weightOf(p, content), 0);
}

/** The webbing worn and the rucksack on his back are carriers, not contents. */
function isContainerItself(p: Carried, content: Content) {
  return Boolean(itemOf(content, p.item).container) && (p.where === 'worn' || p.where === 'cart');
}

/** Weight on his body: hands, pockets, webbing and rucksack. Not clothes, not the pram. */
export function bodyLoad(state: RunState, content: Content): number {
  return state.pack
    .filter((p) => ['hands', 'pockets', 'webbing', 'rucksack'].includes(p.where))
    .reduce((n, p) => n + weightOf(p, content), 0);
}

/** Multiplier on walking fatigue for the load he carries. */
export function loadFactor(state: RunState, content: Content): number {
  return 1 + Math.max(0, bodyLoad(state, content) - PACK.workingLoad) * PACK.fatiguePerKgOver;
}

export function hasPram(state: RunState, content: Content): boolean {
  return state.pack.some((p) => itemOf(content, p.item).container?.slot === 'cart');
}

// ================================================================ putting things away

export interface Placed {
  item: string;
  qty: number;
}

/**
 * Put a find in the pack, where it fits. A container item (a rucksack, a
 * pram) is put to use at once. What will not fit is left at the place he
 * stands, where he can take it up again.
 */
export function place(
  state: RunState,
  content: Content,
  itemId: string,
  qty: number,
  opts: { contamination?: Carried['contamination']; rng?: Rng } = {},
): { taken: Placed[]; left: Placed[] } {
  const def = itemOf(content, itemId);
  const taken: Placed[] = [];
  const left: Placed[] = [];

  if (def.container && def.container.slot !== 'pockets') {
    const slot = def.container.slot;
    const have = containers(state, content)[slot];
    if (!have) {
      push(state, def, itemId, 1, slot === 'cart' ? 'cart' : 'worn', opts);
      taken.push({ item: itemId, qty: 1 });
      if (qty > 1) leave(state, content, def, itemId, qty - 1, opts, left);
      return { taken, left };
    }
  }

  const room = containers(state, content);
  const firsts: Container[] = def.weight <= PACK.pocketable ? ORDER : [...ORDER.filter((c) => c !== 'pockets'), 'pockets'];
  let remaining = qty;
  for (const where of firsts) {
    if (remaining <= 0) break;
    const cap = room[where];
    if (!cap) continue;
    const free = cap - loadIn(state, content, where);
    const fits = def.weight > 0 ? Math.min(remaining, Math.floor((free + 1e-9) / def.weight)) : remaining;
    if (fits <= 0) continue;
    if (def.stackable) push(state, def, itemId, fits, where, opts);
    else for (let i = 0; i < fits; i++) push(state, def, itemId, 1, where, opts);
    remaining -= fits;
    taken.push({ item: itemId, qty: fits });
  }
  if (remaining > 0) leave(state, content, def, itemId, remaining, opts, left);
  return { taken: merge(taken), left };
}

function push(
  state: RunState,
  def: ItemDef,
  itemId: string,
  qty: number,
  where: Carried['where'],
  opts: { contamination?: Carried['contamination']; rng?: Rng },
) {
  const same = def.stackable && state.pack.find((p) => p.item === itemId && p.where === where && !p.left);
  if (same) {
    same.qty += qty;
    return;
  }
  state.pack.push({
    uid: nextUid(state),
    item: itemId,
    qty,
    where,
    condition: 100,
    contamination: opts.contamination ?? 'clean',
    ...(def.vessel ? { fill: { litres: 0, water: 'clean' as const } } : {}),
    ...(def.food?.unknown && def.food.contents && opts.rng ? { secret: drawContents(def, opts.rng) } : {}),
  });
}

function leave(
  state: RunState,
  content: Content,
  def: ItemDef,
  itemId: string,
  qty: number,
  opts: { contamination?: Carried['contamination']; rng?: Rng },
  left: Placed[],
) {
  const cache = state.nodes[state.node]!.cache;
  const copies = def.stackable ? [qty] : Array.from({ length: qty }, () => 1);
  for (const q of copies)
    cache.push({
      uid: cacheUid(state),
      item: itemId,
      qty: q,
      where: 'webbing',
      condition: 100,
      contamination: opts.contamination ?? 'clean',
      ...(def.vessel ? { fill: { litres: 0, water: 'clean' as const } } : {}),
      ...(def.food?.unknown && def.food.contents && opts.rng ? { secret: drawContents(def, opts.rng) } : {}),
    });
  left.push({ item: itemId, qty });
  void content;
}

function merge(xs: Placed[]): Placed[] {
  const out: Placed[] = [];
  for (const x of xs) {
    const same = out.find((o) => o.item === x.item);
    if (same) same.qty += x.qty;
    else out.push({ ...x });
  }
  return out;
}

function drawContents(def: ItemDef, rng: Rng): string {
  return rng.weighted(def.food!.contents!, (c) => c.weight).key;
}

// ================================================================ leaving and taking up

/** Ids for things left at a place: unique across the whole map. */
function cacheUid(state: RunState): string {
  let n = 0;
  for (const node of Object.values(state.nodes)) for (const c of node.cache) n = Math.max(n, Number(c.uid.slice(1)) || 0);
  return `c${n + 1}`;
}

/** Can this be put down? Never the coins or the photograph; never the webbing while it has things in it. */
export function canLeave(state: RunState, content: Content, uid: string): boolean {
  const p = state.pack.find((x) => x.uid === uid);
  if (!p) return false;
  const def = itemOf(content, p.item);
  if (def.bound) return false;
  if (def.container && isContainerItself(p, content)) return loadIn(state, content, def.container.slot) === 0;
  return true;
}

/** Put something down here. It stays with the place. */
export function leaveHere(state: RunState, content: Content, uid: string): RunState {
  if (!canLeave(state, content, uid)) return state;
  const s = structuredClone(state);
  const i = s.pack.findIndex((x) => x.uid === uid);
  const [p] = s.pack.splice(i, 1);
  s.nodes[s.node]!.cache.push({ ...p!, uid: cacheUid(s), where: 'webbing' });
  return s;
}

/** Take something up from what was left here. Returns what would not fit. */
export function takeUp(state: RunState, content: Content, uid: string): Placed[] {
  const cache = state.nodes[state.node]!.cache;
  const i = cache.findIndex((x) => x.uid === uid);
  if (i < 0) return [];
  const [p] = cache.splice(i, 1);
  const before = state.pack.length;
  const { left } = place(state, content, p!.item, p!.qty, { contamination: p!.contamination });
  // Carry over what the find already was: part eaten, what is in the tin, the water in it.
  const added = state.pack.slice(before);
  for (const a of added) {
    if (p!.secret) a.secret = p!.secret;
    if (p!.left) a.left = p!.left;
    if (p!.fill) a.fill = { ...p!.fill };
    a.condition = p!.condition;
  }
  // What did not fit went back into the cache as a fresh entry; that is the right outcome.
  return left;
}

/** The pram cannot leave the road. It and all in it stay where he stands. */
export function abandonPram(state: RunState, content: Content): Placed[] {
  const cache = state.nodes[state.node]!.cache;
  const going = state.pack.filter((p) => p.where === 'cart' || itemOf(content, p.item).container?.slot === 'cart');
  state.pack = state.pack.filter((p) => !going.includes(p));
  for (const p of going) cache.push({ ...p, uid: cacheUid(state), where: 'cart' });
  return going.map((p) => ({ item: p.item, qty: p.qty }));
}

/** For looters, later: take everything but the bound things. */
export function strip(state: RunState, content: Content): Placed[] {
  const taken = state.pack.filter((p) => !itemOf(content, p.item).bound);
  state.pack = state.pack.filter((p) => itemOf(content, p.item).bound);
  return taken.map((p) => ({ item: p.item, qty: p.qty }));
}

// ================================================================ wear

/** Walking wears his boots. Worn through, the road starts on his feet. */
export function wearBoots(state: RunState, content: Content, hours: number, rng: Rng): boolean {
  const boots = state.pack.find((p) => p.where === 'worn' && itemOf(content, p.item).wear?.slot === 'feet');
  if (!boots) return rng.chance(PACK.footWoundChance * 2) && footWound(state);
  boots.condition = Math.max(0, Math.round((boots.condition - hours * PACK.bootWearPerHour) * 10) / 10);
  return boots.condition < PACK.bootsGone && rng.chance(PACK.footWoundChance) && footWound(state);
}

function footWound(state: RunState): boolean {
  const location = state.body.wounds.some((w) => w.location === 'left_foot' && w.state !== 'scarred') ? 'right_foot' : 'left_foot';
  if (state.body.wounds.some((w) => w.location === location && w.state !== 'scarred')) return false;
  state.body.wounds.push({
    uid: `w${state.body.wounds.reduce((m, w) => Math.max(m, Number(w.uid.slice(1)) || 0), 0) + 1}`,
    location,
    severity: 'light',
    state: 'dirty',
    dressed: false,
    since: state.day,
  });
  return true;
}

// ================================================================ tins

export function tinContents(content: Content, p: Carried) {
  const def = itemOf(content, p.item);
  const list = def.food?.contents ?? [];
  return list.find((c) => c.key === p.secret) ?? list[0];
}

// ================================================================ naming things in prose

const NUMBERS = [
  'no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];

export function named(content: Content, item: string, qty: number): string {
  const def = itemOf(content, item);
  if (qty <= 1) return def.name;
  const n = NUMBERS[qty] ?? String(qty);
  return `${n} ${def.plural ?? def.name.replace(/^(a|an|the) /, '')}`;
}

/** `four candles and a box of matches and a tin of sardines`. */
export function list(parts: string[]): string {
  return parts.join(' and ');
}
