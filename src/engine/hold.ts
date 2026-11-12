/**
 * Hold: his grip on himself and on what is real, 0–100.
 *
 *   Steady 75–100   normal narration
 *   Frayed 50–74    intrusive memories, occasional uncanny events
 *   Unmoored 25–49  frequent uncanny events, counts and faces may be misread
 *   Lost 1–24       voices no one else hears; his feet may take him elsewhere
 *   Gone 0          the Long Walk
 *
 * Unreliable narration stays fair: a count he reads off may be wrong, but
 * what is in the pack, a wound, or a fragment never is.
 *
 * All tuning numbers are in HOLD, for Stage 7 to adjust.
 */
import type { RunState } from '../schema/run-state.js';
import { band } from './body.js';
import { daysAlone, meets } from './conditions.js';
import { type Content, itemOf, templateOf } from './content.js';
import { applyEffects } from './effects.js';
import { phrase } from './phrases.js';
import { holdBand, resolve } from './prose.js';
import { hash, Rng } from './rng.js';

export const HOLD = {
  /** Loss each night alone: base plus a little more for every month alone, capped. */
  isolationBase: 1,
  isolationPerMonth: 1,
  isolationCap: 3,
  /** Days without company before isolation starts to tell. */
  isolationGrace: 3,
  warmNight: 1,
  /** Warm nights restore him only this far. */
  warmCeiling: 75,
  coldNight: -1,
  freezingNight: -3,
  fever: -2,
  pneumonia: -1,
  starving: -1,
  parched: -1,
  /** The photograph, by band: steady, frayed, unmoored, lost. */
  photograph: { steady: 3, frayed: 2, unmoored: 1, lost: 0 },
  /** Days before the photograph helps again. */
  photographRest: 3,
  /** Chance of an uncanny event at each hook (four a day), by band. */
  uncanny: { steady: 0.01, frayed: 0.04, unmoored: 0.1, lost: 0.18 },
  /** Chance a dawn opens on an intrusive memory, by band. */
  memory: { steady: 0, frayed: 0.25, unmoored: 0.4, lost: 0.3 },
  /** Chance at night of a voice, when Lost. */
  voice: 0.4,
  /** Chance, when Lost, that a walk goes somewhere he did not choose. */
  wander: 0.15,
  /** Chance, when Unmoored or Lost, that a count he reads off is wrong. */
  miscount: 0.3,
};

type Band = 'steady' | 'frayed' | 'unmoored' | 'lost';

export function currentBand(state: RunState): Band | 'gone' {
  return holdBand(state.hold);
}

const clamp = (v: number) => Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;

// ================================================================ overnight

export function holdOvernight(state: RunState, chill: number, quality: number) {
  let d = 0;
  const alone = daysAlone(state);
  if (alone > HOLD.isolationGrace)
    d -= Math.min(HOLD.isolationCap, HOLD.isolationBase + (HOLD.isolationPerMonth * alone) / 30);
  if (chill > 12) d += HOLD.freezingNight;
  else if (chill > 0) d += HOLD.coldNight;
  else if (quality >= 2 && state.hold < HOLD.warmCeiling) d += HOLD.warmNight;

  const ill = state.body.illnesses;
  if (ill.some((i) => i.kind === 'fever')) d += HOLD.fever;
  if (ill.some((i) => i.kind === 'pneumonia')) d += HOLD.pneumonia;
  if (['failing', 'dying'].includes(band(state.body.hunger))) d += HOLD.starving;
  if (['failing', 'dying'].includes(band(state.body.thirst))) d += HOLD.parched;
  state.hold = clamp(state.hold + d);
}

/** At zero he walks out of the game into the fog. Call after anything that lowers Hold. */
export function checkHold(state: RunState) {
  if (!state.ended && state.hold <= 0) state.ended = { ending: 'long_walk', day: state.day };
}

// ================================================================ the photograph

export function photographChoice(state: RunState): { id: string; label: string } | undefined {
  if (state.today.photograph || !state.pack.some((p) => p.item === 'item.photograph')) return undefined;
  return { id: 'photograph', label: 'Look at the photograph.' };
}

export function lookAtPhotograph(state: RunState, content: Content): string[] {
  state.today.photograph = true;
  const b = currentBand(state);
  const last = Number(state.flags['hold.photograph_day'] ?? -99);
  if (b !== 'gone' && state.day - last >= HOLD.photographRest) {
    state.hold = clamp(state.hold + HOLD.photograph[b]);
    state.flags['hold.photograph_day'] = state.day;
  }
  const description = resolve(itemOf(content, 'item.photograph').description, state.hold);
  return [phrase(content, state, 'tend.photograph', { photograph: description })];
}

// ================================================================ intrusions and voices

/** Dawn may open on a memory. Seeded from the day, so it is the same on reload. */
export function dawnIntrusion(state: RunState, content: Content): string | undefined {
  const b = currentBand(state);
  if (b === 'gone' || b === 'steady') return undefined;
  const rng = new Rng(hash(`${state.seed}/${state.day}/memory`));
  return rng.chance(HOLD.memory[b]) ? phrase(content, state, 'hold.memory') : undefined;
}

export function nightVoice(state: RunState, content: Content, rng: Rng): string | undefined {
  return currentBand(state) === 'lost' && rng.chance(HOLD.voice) ? phrase(content, state, 'hold.voice', {}, 'voice') : undefined;
}

/** When Lost, the walk he chose may not be the walk he takes. Returns the destination actually walked to. */
export function wander(state: RunState, chosen: string, rng: Rng): string {
  if (currentBand(state) !== 'lost' || !rng.chance(HOLD.wander)) return chosen;
  const others = state.nodes[state.node]!.links.map((l) => l.to).filter((to) => to !== chosen);
  return others.length ? rng.pick(others) : chosen;
}

/**
 * A count as he reads it off. Unmoored or Lost, it may be one out. Used
 * only in narration: the pack itself always holds the true number.
 */
export function misread(state: RunState, qty: number, rng: Rng): number {
  const b = currentBand(state);
  if ((b !== 'unmoored' && b !== 'lost') || !rng.chance(HOLD.miscount)) return qty;
  return qty <= 1 ? 2 : qty + (rng.chance(0.5) ? 1 : -1);
}

// ================================================================ the uncanny

export type Hook = 'move' | 'inspect' | 'tend' | 'night';

/**
 * Maybe fire an uncanny event at this point in the day. At most one a day.
 * Odds rise as Hold falls, with fever, with long solitude, and in regions
 * where the uncanny runs strong.
 */
export function maybeUncanny(state: RunState, content: Content, hook: Hook, rng: Rng): string[] {
  const b = currentBand(state);
  if (b === 'gone') return [];
  if (Object.entries(state.fired).some(([id, day]) => id.startsWith('uncanny.') && day === state.day)) return [];

  const node = state.nodes[state.node]!;
  const region = content.regions.get(node.region);
  let p = HOLD.uncanny[b] * (region?.uncanny ?? 1);
  if (state.body.illnesses.some((i) => i.kind === 'fever')) p *= 1.5;
  if (daysAlone(state) > 40) p *= 1.2;
  if (!rng.chance(p)) return [];

  const tags = templateOf(content, node.template).nodeTags;
  const pool = content.all.uncanny.filter(
    (u) =>
      u.phases.includes(hook) &&
      (!u.regions || u.regions.includes(node.region)) &&
      (!u.once || state.fired[u.id] === undefined) &&
      meets(u.when, state, content),
  );
  if (!pool.length) return [];
  // Places with a strong night-world (ossuaries, mines, deep forest) favour their own events.
  const u = rng.weighted(pool, (x) => x.weight * (x.when.nodeTags?.some((t) => tags.includes(t)) ? 2 : 1));
  state.fired[u.id] = state.day;
  return [resolve(u.text, state.hold), ...applyEffects(state, content, u.effects)];
}
