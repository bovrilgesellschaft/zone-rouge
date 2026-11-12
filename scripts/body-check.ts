/**
 * Checks on the body and weather that a headless walk will rarely reach:
 * nights in the open, wet clothes, wounds going bad, a winter's weather.
 *
 *   npx tsx scripts/body-check.ts
 */
import { freshDay, sleepAndReckon, checkDeath, insulation } from '../src/engine/body.js';
import { newRun } from '../src/engine/run.js';
import { Rng } from '../src/engine/rng.js';
import { meanTemp, nextWeather, DAY_ONE } from '../src/engine/weather.js';
import type { RunState } from '../src/schema/run-state.js';
import { contentFromDisk } from './node-content.js';

const content = contentFromDisk();
let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

function man(over: (s: RunState) => void = () => {}): RunState {
  const s = structuredClone(newRun('BODY-CHECK', content));
  s.today = { ...freshDay(), kcal: 2400, litres: 2.6 };
  over(s);
  return s;
}

/** Sleep n nights under fixed conditions, feeding and watering him unless told not to. */
function nights(s: RunState, n: number, night: { quality: number; open: boolean; fire: boolean }, fed = true) {
  const rng = new Rng(7);
  for (let i = 0; i < n && !s.ended; i++) {
    sleepAndReckon(s, content, night, rng);
    checkDeath(s);
    s.day += 1;
    s.today = fed ? { ...freshDay(), kcal: 2400, litres: 2.6 } : freshDay();
  }
  return s;
}

// ---------------------------------------------------------------- clothing
const warmth = insulation(man(), content).warmth;
check(warmth === 7, 'starting clothes give warmth 7', `got ${warmth}`);

// ---------------------------------------------------------------- cold
{
  const s = man((s) => { s.weather = { kind: 'sleet', tempC: -12, wind: 3, snow: 2 }; s.body.wet = true; s.body.cold = 30; });
  nights(s, 1, { quality: 0, open: true, fire: false });
  check(s.body.cold >= 70, 'a wet night in the open at -12 in wind is nearly fatal', `cold 30 → ${s.body.cold}`);
}
{
  const s = man((s) => { s.weather = { kind: 'sleet', tempC: -12, wind: 3, snow: 2 }; s.body.wet = true; s.body.cold = 30; });
  nights(s, 3, { quality: 0, open: true, fire: false });
  check(s.ended?.cause === 'cold', 'three such nights kill him', `ended ${JSON.stringify(s.ended)}`);
}
{
  const s = man((s) => { s.weather = { kind: 'overcast', tempC: -8, wind: 1, snow: 2 }; s.body.cold = 50; s.body.wet = true; });
  nights(s, 1, { quality: 3, open: false, fire: true });
  check(s.body.cold < 20 && !s.body.wet, 'a fire in a sound house warms and dries him', `cold 50 → ${s.body.cold}, wet ${s.body.wet}`);
}
{
  const s = man((s) => { s.weather = { kind: 'overcast', tempC: -8, wind: 1, snow: 2 }; s.body.cold = 30; });
  nights(s, 1, { quality: 1, open: false, fire: false });
  check(s.body.cold > 30 && s.body.cold < 70, 'a shed without a fire is a cold night but not a fatal one', `cold 30 → ${s.body.cold}`);
}

// ---------------------------------------------------------------- hunger and thirst
{
  const s = man();
  nights(s, 40, { quality: 3, open: false, fire: true }, false);
  check(s.ended?.cause === 'thirst' && s.day <= 5, 'with no water he dies of thirst within days', `day ${s.day}`);
}
{
  const s = man();
  const rng = new Rng(3);
  let day = 0;
  while (!s.ended && day < 60) {
    s.today = { ...freshDay(), kcal: 0, litres: 2.6 };
    sleepAndReckon(s, content, { quality: 3, open: false, fire: true }, rng);
    checkDeath(s);
    s.day += 1;
    day++;
  }
  check(s.ended?.cause === 'hunger' && day >= 12 && day <= 25, 'with water but no food he starves in two to three weeks', `after ${day} days`);
}

// ---------------------------------------------------------------- wounds
{
  let died = 0;
  let healed = 0;
  for (let seed = 0; seed < 200; seed++) {
    const s = man((s) => s.body.wounds.push({ uid: 'wx', location: 'left_leg', severity: 'serious', state: 'infected', dressed: true, since: 1 }));
    const rng = new Rng(seed);
    for (let i = 0; i < 20 && !s.ended; i++) {
      s.today = { ...freshDay(), kcal: 2400, litres: 2.6 };
      sleepAndReckon(s, content, { quality: 3, open: false, fire: true }, rng);
      checkDeath(s);
      s.day += 1;
    }
    if (s.ended?.cause === 'infection') died++;
    else if (!s.body.wounds.some((w) => w.uid === 'wx' && w.state === 'infected')) healed++;
  }
  check(died > 60 && died < 160, 'an infected wound untreated kills more often than not', `${died}/200 died, ${healed} healed`);
}
{
  let fevers = 0;
  for (let seed = 0; seed < 50; seed++) {
    const s = man((s) => s.body.wounds.push({ uid: 'wx', location: 'left_leg', severity: 'light', state: 'infected', dressed: true, since: 1 }));
    sleepAndReckon(s, content, { quality: 3, open: false, fire: true }, new Rng(seed));
    const infected = s.body.wounds.some((w) => w.state === 'infected');
    const fever = s.body.illnesses.some((i) => i.kind === 'fever');
    if (infected !== fever) fevers = -999;
    else if (fever) fevers++;
  }
  check(fevers > 35, 'an infected wound brings a fever, and only an infected wound', `${Math.max(0, fevers)}/50 nights`);
}

// ---------------------------------------------------------------- weather
{
  const early: number[] = [];
  const late: number[] = [];
  const kinds: Record<string, number> = {};
  for (let seed = 0; seed < 50; seed++) {
    const rng = new Rng(seed);
    let w = { ...DAY_ONE };
    for (let day = 2; day <= 80; day++) {
      w = nextWeather(w, day, rng);
      (day <= 30 ? early : day >= 60 ? late : []).push(w.tempC);
      kinds[w.kind] = (kinds[w.kind] ?? 0) + 1;
    }
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  check(avg(early) < -5 && avg(late) > avg(early) + 2, 'January is deep winter and March is kinder', `early ${avg(early).toFixed(1)}°, late ${avg(late).toFixed(1)}°, mean day 80 ${meanTemp(80)}°`);
  console.log(`      50 winters of weather: ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}`);
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll body and weather checks passed.');
process.exit(failures ? 1 : 0);
