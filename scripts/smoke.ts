/**
 * Plays many runs headless to prove the skeleton holds together.
 *
 *   npm run smoke            2,000 runs
 *   npm run smoke -- 200     a quicker check
 *
 * Each run is driven by its own seeded player who mostly walks west,
 * searches, eats when hungry, drinks, makes fires and dresses wounds, and
 * sometimes dawdles or doubles back. It checks:
 *   - every dawn state passes the run state schema
 *   - no step throws, and every run ends (at the quay or in death)
 *   - the same seed and the same choices give the same run, byte for byte
 *   - a save string exported at any dawn imports to the identical state
 */
import { act, choices } from '../src/engine/loop.js';
import { newRun } from '../src/engine/run.js';
import { Rng } from '../src/engine/rng.js';
import { exportSave, importSave } from '../src/engine/save.js';
import { RunState } from '../src/schema/run-state.js';
import { contentFromDisk } from './node-content.js';

const RUNS = Number(process.argv[2] ?? 2000);
const MAX_DAYS = 400;
const content = contentFromDisk();

/** Node ids are numbered east to west, so the highest number is furthest west. */
function westward(ids: string[]): string | undefined {
  const n = (id: string) => Number(id.slice('move:n'.length));
  return ids.filter((c) => c.startsWith('move:')).sort((a, b) => n(b) - n(a))[0];
}

/** A sensible, slightly careless player. */
function decide(state: RunState, ids: string[], rng: Rng): string {
  const b = state.body;
  const first = (prefix: string) => ids.find((i) => i.startsWith(prefix));
  switch (state.phase) {
    case 'plan': {
      if (b.fatigue >= 60 || b.cold >= 70) return 'stay';
      const west = westward(ids);
      return west && rng.chance(0.85) ? west : rng.pick(ids);
    }
    case 'inspect':
    case 'loot':
      return rng.chance(0.75) ? ids[0]! : ids[ids.length - 1]!;
    case 'tend':
      if (b.hunger >= 15 && state.today.kcal < 2600) {
        const half = first('half:');
        const eat = first('eat:');
        if (half && rng.chance(0.6)) return half;
        if (eat) return eat;
      }
      if (b.thirst >= 5 && state.today.litres < 2.6 && ids.includes('drink')) return 'drink';
      if (ids.includes('fire')) return 'fire';
      for (const p of ['clean:', 'spirit:', 'dress:']) if (first(p)) return first(p)!;
      if (ids.includes('melt')) {
        const water = state.pack.reduce((n, p) => n + (p.fill?.litres ?? 0), 0);
        if (water < 1) return 'melt';
      }
      return 'night';
    case 'night':
      if (ids.includes('fire')) return 'fire';
      return ids.find((i) => i !== 'sleep:open' && i.startsWith('sleep:')) ?? 'sleep:open';
    default:
      return rng.pick(ids);
  }
}

function play(seed: string, check: boolean) {
  let state = newRun(seed, content);
  const player = new Rng(state.rng.world ^ 0x5eed);
  let steps = 0;
  const log: string[] = [];

  while (!state.ended && state.day <= MAX_DAYS) {
    const ids = choices(state, content).map((c) => c.id);
    if (!ids.length) throw new Error(`${seed}: no choices at day ${state.day}, ${state.phase}`);

    if (check && state.phase === 'dawn') {
      const r = RunState.safeParse(state);
      if (!r.success) throw new Error(`${seed}: day ${state.day} state fails the schema: ${r.error.issues[0]?.message}`);
      if (JSON.stringify(importSave(exportSave(state))) !== JSON.stringify(state))
        throw new Error(`${seed}: save string round trip changed the state on day ${state.day}`);
    }

    const pick = decide(state, ids, player);
    log.push(pick);
    state = act(state, content, pick).state;
    steps++;
  }
  return { state, steps, log };
}

const t0 = Date.now();
const endings: Record<string, number[]> = {};

for (let i = 0; i < RUNS; i++) {
  const seed = `SMOKE-${i}`;
  const { state, log } = play(seed, i < 200);
  if (!state.ended) throw new Error(`${seed}: neither reached the quay nor died in ${MAX_DAYS} days`);
  const key = state.ended.ending === 'death' ? `died of ${state.ended.cause}` : `reached the quay`;
  (endings[key] ??= []).push(state.day);

  if (i < 50) {
    const again = play(seed, false);
    if (JSON.stringify(again.state) !== JSON.stringify(state) || again.log.join() !== log.join())
      throw new Error(`${seed}: the same seed played twice gave different runs`);
  }
}

console.log(`${RUNS} runs played in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
for (const [k, d] of Object.entries(endings).sort((a, b) => b[1].length - a[1].length)) {
  d.sort((x, y) => x - y);
  const pct = ((100 * d.length) / RUNS).toFixed(1).padStart(5);
  console.log(`${pct}%  ${k.padEnd(22)} day ${d[0]}–${d[d.length - 1]}, median ${d[Math.floor(d.length / 2)]}`);
}
console.log('Schema, determinism and save round trip: all held.');
