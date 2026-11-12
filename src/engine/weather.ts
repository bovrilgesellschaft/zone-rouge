/**
 * The seeded weather calendar. Drawn each dawn from the weather stream,
 * so the same seed gives the same winter whatever he does.
 *
 * Soot in the upper air keeps the winter deep: about eight degrees below
 * a normal Lorraine January, easing from late February. Each day's
 * temperature keeps something of yesterday's, so cold spells and thaws
 * run for days at a time.
 */
import type { RunState } from '../schema/run-state.js';
import { Rng } from './rng.js';

type W = RunState['weather'];
type Kind = W['kind'];

/** The temperature a day would have with no spell of weather on it. */
export function meanTemp(day: number): number {
  return -8 + Math.max(0, day - 35) * 0.15;
}

/** Day 1, fixed: overcast, still, a hard frost, the snow lying. Matches gold day 1. */
export const DAY_ONE: W = { kind: 'overcast', tempC: -6, wind: 0, snow: 2 };

const TABLES: { upTo: number; kinds: [Kind, number][] }[] = [
  { upTo: -2, kinds: [['clear', 25], ['overcast', 40], ['fog', 15], ['snow', 20]] },
  { upTo: 2, kinds: [['overcast', 35], ['fog', 15], ['snow', 15], ['sleet', 15], ['thaw', 10], ['rain', 10]] },
  { upTo: Infinity, kinds: [['overcast', 35], ['rain', 30], ['thaw', 20], ['fog', 15]] },
];

/** Tomorrow's weather from today's. */
export function nextWeather(prev: W, day: number, rng: Rng): W {
  // Temperature: keep 60 per cent of yesterday's departure from the mean, add a fresh one.
  const anomaly = 0.6 * (prev.tempC - meanTemp(day - 1)) + (rng.next() + rng.next() + rng.next() - 1.5) * 4;
  const tempC = Math.round((meanTemp(day) + anomaly) * 2) / 2;

  const table = TABLES.find((t) => tempC <= t.upTo)!.kinds.filter(([k]) => k !== 'thaw' || prev.snow > 0);
  let kind: Kind =
    table.some(([k]) => k === prev.kind) && rng.chance(0.4) ? prev.kind : rng.weighted(table, ([, w]) => w)[0];

  // Rarities. Black rain in the first weeks, when there is still dirt in the sky.
  if ((kind === 'rain' || kind === 'sleet') && day <= 25 && rng.chance(0.08)) kind = 'black_rain';
  if (prev.kind === 'rain' && tempC > -2 && tempC <= 1 && rng.chance(0.15)) kind = 'ice_storm';

  let snow = prev.snow;
  if (kind === 'snow') snow += 1;
  if (kind === 'thaw' || kind === 'rain' || kind === 'black_rain' || tempC > 3) snow -= 1;
  snow = Math.max(0, Math.min(3, snow));

  const wind = rng.weighted([0, 1, 2, 3], (w) => [30, 40, 22, 8][w]!);
  return { kind, tempC, wind, snow };
}

/** Extra hours on a walk for snow lying and ice. */
export function weatherHours(w: W): number {
  return w.snow * 0.5 + (w.kind === 'ice_storm' ? 1 : 0) + (w.kind === 'snow' ? 0.5 : 0);
}

/** Weather that soaks a man walking in it. */
export function soaking(w: W): boolean {
  return w.kind === 'rain' || w.kind === 'sleet' || w.kind === 'black_rain' || w.kind === 'thaw' || w.kind === 'ice_storm';
}
