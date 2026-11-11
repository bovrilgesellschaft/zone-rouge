/** Choosing the right text for the man's state. */
import type { z } from 'zod';
import type { Prose } from '../schema/common.js';

type HoldBand = 'steady' | 'frayed' | 'unmoored' | 'lost';

export function holdBand(hold: number): HoldBand | 'gone' {
  if (hold <= 0) return 'gone';
  if (hold < 25) return 'lost';
  if (hold < 50) return 'unmoored';
  if (hold < 75) return 'frayed';
  return 'steady';
}

const ORDER: HoldBand[] = ['steady', 'frayed', 'unmoored', 'lost'];

/** A band left out falls back to the next steadier band. */
export function resolve(prose: z.output<typeof Prose>, hold: number): string {
  if (typeof prose === 'string') return prose;
  const band = holdBand(hold);
  const at = band === 'gone' ? ORDER.length - 1 : ORDER.indexOf(band);
  for (let i = at; i >= 0; i--) {
    const t = prose[ORDER[i]!];
    if (t) return t;
  }
  return prose.steady;
}

/** `The woodshed.` → `the woodshed`, for use inside a sentence. */
export function inline(label: string): string {
  const s = label.replace(/[.]$/, '');
  return /^(The|A|An) /.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s;
}

const KIND_NAMES: Record<string, string> = {
  cabin: 'the cabin', farm: 'a farm', hamlet: 'a hamlet', house: 'a house', crossroads: 'a crossroads',
  forest_track: 'a forest track', colliery: 'a colliery', cite: 'a miners’ estate', fort: 'a fort',
  convoy: 'a convoy', town_edge: 'the edge of a town', church: 'a church', works: 'a works', quay: 'the quay',
  landmark: 'a landmark',
};

/** Placeholder name for a place until the text grammar arrives. */
export function kindName(kind: string): string {
  return KIND_NAMES[kind] ?? kind;
}
