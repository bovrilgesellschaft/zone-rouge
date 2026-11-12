/** Does the run meet a record's `when`? Shared by every system that draws content. */
import type { z } from 'zod';
import type { Conditions } from '../schema/common.js';
import type { RunState } from '../schema/run-state.js';
import { type Content, templateOf } from './content.js';
import { holdBand } from './prose.js';

type C = z.output<typeof Conditions>;
type Range = number | { eq?: number; gt?: number; gte?: number; lt?: number; lte?: number };

function inRange(v: number, r: Range | undefined): boolean {
  if (r === undefined) return true;
  if (typeof r === 'number') return v === r;
  return (
    (r.eq === undefined || v === r.eq) &&
    (r.gt === undefined || v > r.gt) &&
    (r.gte === undefined || v >= r.gte) &&
    (r.lt === undefined || v < r.lt) &&
    (r.lte === undefined || v <= r.lte)
  );
}

export function timeOfDay(state: RunState): 'day' | 'dusk' | 'night' {
  if (state.phase === 'night' || state.hoursLeft <= -1) return 'night';
  if (state.phase === 'tend' || state.hoursLeft <= 1) return 'dusk';
  return 'day';
}

export const daysAlone = (state: RunState) => state.day - state.lastCompany;

export function meets(when: C | undefined, state: RunState, content: Content): boolean {
  if (!when) return true;
  const node = state.nodes[state.node]!;
  const band = holdBand(state.hold);
  const fever = state.body.illnesses.some((i) => i.kind === 'fever');
  const sick = state.body.illnesses.some((i) => i.kind === 'radiation_sickness');
  const flag = (f: string) => Boolean(state.flags[f]);

  return (
    inRange(state.day, when.day) &&
    inRange(state.hold, when.hold) &&
    (!when.holdBand || (band !== 'gone' && when.holdBand.includes(band))) &&
    (!when.region || when.region.includes(node.region)) &&
    (!when.phase || when.phase.includes(state.phase)) &&
    (!when.timeOfDay || when.timeOfDay.includes(timeOfDay(state))) &&
    (!when.weather || when.weather.includes(state.weather.kind)) &&
    inRange(daysAlone(state), when.daysAlone) &&
    inRange(state.noise, when.noise) &&
    (when.fever === undefined || when.fever === fever) &&
    (when.radiationSick === undefined || when.radiationSick === sick) &&
    (!when.nodeTags || when.nodeTags.every((t) => templateOf(content, node.template).nodeTags.includes(t))) &&
    (!when.flags?.set || when.flags.set.every(flag)) &&
    (!when.flags?.unset || !when.flags.unset.some(flag)) &&
    (!when.hasItem || when.hasItem.every((i) => state.pack.some((p) => p.item === i))) &&
    (!when.truth || when.truth.includes(state.truth))
  );
}
