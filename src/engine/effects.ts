/** Applying a content record's `effects` to the run. Shared by every system that fires content. */
import type { z } from 'zod';
import type { Effects } from '../schema/common.js';
import type { RunState } from '../schema/run-state.js';
import { clampNeeds } from './body.js';
import { place } from './pack.js';
import { type Content, itemOf } from './content.js';

type E = z.output<typeof Effects>;

/** Returns any prose the effects produce (placeholders for systems not yet built). */
export function applyEffects(state: RunState, content: Content, e: E | undefined): string[] {
  if (!e) return [];
  const text: string[] = [];
  for (const f of e.setFlags ?? []) state.flags[f] = true;
  for (const f of e.clearFlags ?? []) delete state.flags[f];
  if (e.hold) state.hold = Math.max(0, Math.min(100, state.hold + e.hold));
  if (e.hours) state.hoursLeft = Math.round((state.hoursLeft - e.hours) * 2) / 2;
  if (e.noise) state.noise = Math.max(0, state.noise + e.noise);
  if (e.needs) for (const [k, v] of Object.entries(e.needs)) state.body[k as 'hunger'] += v ?? 0;
  if (e.dose) state.dose.total += e.dose;
  if (e.company) state.lastCompany = state.day;
  for (const r of e.learnRecipes ?? []) if (!state.knownRecipes.includes(r)) state.knownRecipes.push(r);

  for (const { item, qty } of e.addItems ?? []) place(state, content, item, qty, { contamination: 'unknown' });
  for (const { item, qty } of e.removeItems ?? []) {
    let left = qty;
    for (const p of state.pack.filter((p) => p.item === item && !itemOf(content, item).bound)) {
      const take = Math.min(left, p.qty);
      p.qty -= take;
      left -= take;
    }
    state.pack = state.pack.filter((p) => p.qty > 0);
  }

  if (e.wound)
    state.body.wounds.push({
      uid: `w${state.body.wounds.reduce((m, w) => Math.max(m, Number(w.uid.slice(1)) || 0), 0) + 1}`,
      ...e.wound,
      dressed: false,
      since: state.day,
    });
  if (e.illness && !state.body.illnesses.some((i) => i.kind === e.illness))
    state.body.illnesses.push({ kind: e.illness, since: state.day, severity: 1 });
  if (e.drawFragment)
    text.push(`[A fragment would be drawn here${e.drawFragment.thread ? `: ${e.drawFragment.thread}` : ''}. Fragments arrive with the journal.]`);

  clampNeeds(state);
  return text;
}
