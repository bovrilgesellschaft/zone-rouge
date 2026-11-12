/**
 * Drawing recurring prose from content/phrases. The draw is seeded from
 * the run, the day and a salt, so it is the same every time the same
 * moment is shown (on reload, in tests) and never touches the run's
 * own random streams.
 */
import type { PhraseSlot } from '../schema/content.js';
import type { RunState } from '../schema/run-state.js';
import { meets } from './conditions.js';
import type { Content } from './content.js';
import { resolve } from './prose.js';
import { hash, Rng } from './rng.js';

export function phrase(
  content: Content,
  state: RunState,
  slot: PhraseSlot,
  tokens: Record<string, string> = {},
  salt = '',
): string {
  const pool = content.all.phrases.filter((p) => p.slot === slot && meets(p.when, state, content));
  if (!pool.length) {
    const t = Object.values(tokens);
    return `[${slot}${t.length ? `: ${t.join(', ')}` : ''}]`;
  }
  const rng = new Rng(hash(`${state.seed}/${state.day}/${state.phase}/${slot}/${salt}`));
  const p = rng.weighted(pool, (x) => x.weight);
  return resolve(p.text, state.hold).replace(/\{([a-z_]+)\}/g, (_, k: string) => tokens[k] ?? `{${k}}`);
}

/** Join sentences into one paragraph, keeping placeholders whole. */
export function paragraph(parts: string[]): string {
  return parts.filter(Boolean).join(' ');
}
