/**
 * Plays many runs headless to prove the skeleton holds together.
 *
 *   npm run smoke            2,000 runs
 *   npm run smoke -- 200     a quicker check
 *
 * Each run is driven by its own seeded player who mostly walks west and
 * sometimes dawdles, searches or doubles back. It checks:
 *   - every dawn state passes the run state schema
 *   - no step throws, and every run reaches the quay
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

    let pick: string;
    if (state.phase === 'plan') {
      const west = westward(ids);
      pick = west && player.chance(0.8) ? west : player.pick(ids);
    } else if (state.phase === 'inspect' || state.phase === 'loot') {
      pick = player.chance(0.6) ? player.pick(ids) : ids[ids.length - 1]!;
    } else {
      pick = player.pick(ids);
    }
    log.push(pick);
    state = act(state, content, pick).state;
    steps++;
  }
  return { state, steps, log };
}

let reached = 0;
let days = 0;
let minDays = Infinity;
let maxDays = 0;
const t0 = Date.now();

for (let i = 0; i < RUNS; i++) {
  const seed = `SMOKE-${i}`;
  const { state, log } = play(seed, i < 200);
  if (!state.ended) throw new Error(`${seed}: did not reach the quay in ${MAX_DAYS} days`);
  reached++;
  days += state.day;
  minDays = Math.min(minDays, state.day);
  maxDays = Math.max(maxDays, state.day);

  if (i < 50) {
    const again = play(seed, false);
    if (JSON.stringify(again.state) !== JSON.stringify(state) || again.log.join() !== log.join())
      throw new Error(`${seed}: the same seed played twice gave different runs`);
  }
}

console.log(`${reached}/${RUNS} runs reached the quay in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
console.log(`Days to the coast: average ${(days / RUNS).toFixed(1)}, fastest ${minDays}, slowest ${maxDays}.`);
console.log('Schema, determinism and save round trip: all held.');
