/**
 * Seeded randomness. Each stream (world, weather, events, combat) is a
 * single 32-bit integer kept in the run state, so a run replays exactly
 * from any dawn and one system cannot reshuffle another.
 */

export type Stream = 'world' | 'weather' | 'events' | 'combat';
export type Streams = Record<Stream, number>;

/** Hash a string to a 32-bit integer. */
export function hash(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) | 0;
}

export function seedStreams(seed: string): Streams {
  return {
    world: hash(`${seed}/world`),
    weather: hash(`${seed}/weather`),
    events: hash(`${seed}/events`),
    combat: hash(`${seed}/combat`),
  };
}

/** A short seed a player can read out or type: four letters, four digits. */
export function randomSeed(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return `${s}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
}

/**
 * A mulberry32 generator over one stream. Make one from the state, draw
 * from it, then write `.state` back into the run.
 */
export class Rng {
  constructor(private s: number) {}

  get state(): number {
    return this.s;
  }

  /** A float in [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer from lo to hi inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick from an empty list');
    return items[Math.floor(this.next() * items.length)]!;
  }

  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    const total = items.reduce((n, t) => n + weight(t), 0);
    if (items.length === 0 || total <= 0) throw new Error('weighted pick from nothing');
    let r = this.next() * total;
    for (const t of items) {
      r -= weight(t);
      if (r < 0) return t;
    }
    return items[items.length - 1]!;
  }

  /** Up to n distinct items. */
  sample<T>(items: readonly T[], n: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]!);
    return out;
  }
}
