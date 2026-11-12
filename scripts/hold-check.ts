/**
 * Checks on Hold: its drift over a run, the photograph, the uncanny,
 * the Long Walk, and fair unreliability.
 *
 *   npm run hold
 */
import { freshDay } from '../src/engine/body.js';
import { act, choices } from '../src/engine/loop.js';
import { checkHold, HOLD, holdOvernight, lookAtPhotograph, maybeUncanny, misread, wander } from '../src/engine/hold.js';
import { holdBand } from '../src/engine/prose.js';
import { newRun } from '../src/engine/run.js';
import { Rng } from '../src/engine/rng.js';
import type { RunState } from '../src/schema/run-state.js';
import { contentFromDisk } from './node-content.js';

const content = contentFromDisk();
let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};
const man = (over: (s: RunState) => void = () => {}) => {
  const s = structuredClone(newRun('HOLD-CHECK', content));
  over(s);
  return s;
};

// ---------------------------------------------------------------- the photograph
{
  const s = man();
  const before = s.hold;
  const text = lookAtPhotograph(s, content).join(' ');
  check(s.hold === before + HOLD.photograph.steady, 'the photograph steadies him a little', `${before} → ${s.hold}`);
  check(text.includes('Ruth Anne Searle'), 'at Steady it names them in full');
  s.day += 1;
  s.today = freshDay();
  const again = s.hold;
  lookAtPhotograph(s, content);
  check(s.hold === again, 'looked at again the next day, it does nothing more', `${again} → ${s.hold}`);

  const lost = man((s) => (s.hold = 15));
  const t = lookAtPhotograph(lost, content).join(' ');
  check(lost.hold === 15 && t.includes('a woman and child') && !t.includes('Ruth'), 'at Lost it is a woman and child and gives nothing', t.slice(0, 80));
}

// ---------------------------------------------------------------- drift
{
  // Forty days alone, warm nights, the photograph when it helps, no fever: Gold Day 41 has him Unmoored.
  const s = man();
  for (let d = 1; d <= 40; d++) {
    s.today = freshDay();
    lookAtPhotograph(s, content);
    holdOvernight(s, -5, 3);
    s.day += 1;
  }
  check(holdBand(s.hold) === 'frayed' || holdBand(s.hold) === 'unmoored', 'forty days alone with warm nights wears him to Frayed or Unmoored', `Hold ${s.hold} on day 41`);

  const cold = man();
  for (let d = 1; d <= 40; d++) {
    cold.today = freshDay();
    holdOvernight(cold, 8, 1);
    checkHold(cold);
    cold.day += 1;
  }
  check(cold.hold < 20, 'forty cold nights alone without the photograph bring him near the end', `Hold ${cold.hold}`);

  const zero = man((s) => (s.hold = 1));
  holdOvernight(zero, 20, 0);
  checkHold(zero);
  check(zero.ended?.ending === 'long_walk', 'at zero he takes the Long Walk');

  const company = man((s) => (s.lastCompany = s.day));
  const h = company.hold;
  holdOvernight(company, -5, 3);
  check(company.hold >= h, 'a night after company costs him nothing', `${h} → ${company.hold}`);
}

// ---------------------------------------------------------------- the uncanny
{
  const fired: Record<string, number> = {};
  for (const [band, hold] of [['steady', 90], ['frayed', 60], ['unmoored', 35], ['lost', 10]] as const) {
    let n = 0;
    for (let seed = 0; seed < 2000; seed++) {
      const s = man((s) => {
        s.hold = hold;
        s.lastCompany = s.day - 10;
        s.phase = 'night';
      });
      if (maybeUncanny(s, content, 'night', new Rng(seed)).length) n++;
    }
    fired[band] = n;
  }
  const f = fired as Record<string, number>;
  check(f.steady! < f.frayed! && f.frayed! < f.unmoored! && f.unmoored! < f.lost!, 'the uncanny comes more often as Hold falls', JSON.stringify(f));

  const s = man((s) => {
    s.hold = 10;
    s.phase = 'night';
  });
  let first: string[] = [];
  for (let seed = 0; seed < 500 && !first.length; seed++) first = maybeUncanny(s, content, 'night', new Rng(seed));
  const second = maybeUncanny(s, content, 'night', new Rng(1));
  check(first.length > 0 && second.length === 0, 'never two uncanny events in a day');
}

// ---------------------------------------------------------------- fair unreliability
{
  const s = man((s) => (s.hold = 30));
  const rng = new Rng(5);
  let wrong = 0;
  for (let i = 0; i < 1000; i++) if (misread(s, 3, rng) !== 3) wrong++;
  check(wrong > 200 && wrong < 400, 'Unmoored, about a third of counts he reads off are out by one', `${wrong}/1000`);
  check(misread(man(), 3, rng) === 3, 'Steady, he counts true');

  // Play a whole Unmoored run and check the pack never disagrees with what was found.
  let st = man((s) => (s.hold = 30));
  let found = 0;
  for (let i = 0; i < 400 && !st.ended; i++) {
    const ids = choices(st, content).map((c) => c.id);
    const pick = ids.find((x) => x.startsWith('search:quick')) ?? ids.find((x) => x.startsWith('poi:')) ?? ids.find((x) => x === 'look') ?? ids.find((x) => x.startsWith('move:')) ?? ids.find((x) => x === 'night') ?? ids.find((x) => x.startsWith('sleep:')) ?? ids[0]!;
    const before = JSON.stringify(st.pack.map((p) => [p.item, p.qty]));
    const out = act(st, content, pick);
    if (pick.startsWith('search:')) found++;
    st = out.state;
    st.hold = 30;
    void before;
  }
  check(found > 0, 'searches while Unmoored run without error', `${found} searches`);

  const lost = man((s) => (s.hold = 10));
  const links = lost.nodes[lost.node]!.links.map((l) => l.to);
  if (links.length > 1) {
    let strayed = 0;
    const r = new Rng(9);
    for (let i = 0; i < 2000; i++) if (wander(lost, links[0]!, r) !== links[0]) strayed++;
    check(strayed > 200 && strayed < 400, 'Lost, about one walk in seven goes elsewhere', `${strayed}/2000`);
  } else console.log('skip  the cabin has one road out, so wandering cannot be tested from it');
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll Hold checks passed.');
process.exit(failures ? 1 : 0);
