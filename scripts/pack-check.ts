/**
 * Checks on the pack and the coins.
 *
 *   npm run pack
 */
import { tend } from '../src/engine/body.js';
import { itemOf } from '../src/engine/content.js';
import {
  abandonPram, bodyLoad, canLeave, containers, hasPram, leaveHere, loadFactor, loadIn, PACK, place, strip, takeUp, wearBoots,
} from '../src/engine/pack.js';
import { newRun } from '../src/engine/run.js';
import { Rng } from '../src/engine/rng.js';
import { RunState } from '../src/schema/run-state.js';
import { contentFromDisk } from './node-content.js';

const content = contentFromDisk();
let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};
const man = () => structuredClone(newRun('PACK-CHECK', content));
const uidOf = (s: RunState, item: string) => s.pack.find((p) => p.item === item)!.uid;

// ---------------------------------------------------------------- room
{
  const s = man();
  const c = containers(s, content);
  check(c.pockets === 3 && c.webbing === 8 && !c.rucksack, 'he starts with pockets and webbing only', JSON.stringify(c));
  check(loadIn(s, content, 'webbing') <= 8 && loadIn(s, content, 'pockets') <= 3, 'the starting kit fits', `webbing ${loadIn(s, content, 'webbing').toFixed(1)} kg`);
  check(loadFactor(s, content) === 1, 'the starting load does not slow him', `${bodyLoad(s, content).toFixed(1)} kg on his body`);

  const r = place(s, content, 'item.vittel_bottle', 5, {});
  const took = r.taken.reduce((n, x) => n + x.qty, 0);
  check(took >= 1 && took < 5 && r.left[0]?.qty === 5 - took, 'five bottles of water will not all fit; the rest stay behind', `took ${took}, left ${r.left[0]?.qty}`);
  check(loadIn(s, content, 'webbing') <= 8 + 1e-9 && loadIn(s, content, 'pockets') <= 3 + 1e-9, 'no container is ever overfilled');
  check(s.nodes[s.node]!.cache.length === 1, 'what he could not carry is left at the place');

  const cached = s.nodes[s.node]!.cache[0]!.uid;
  place(s, content, 'item.rucksack', 1, {});
  check(containers(s, content).rucksack === 20 && s.pack.some((p) => p.item === 'item.rucksack' && p.where === 'worn'), 'a rucksack found is put on at once');
  const left = takeUp(s, content, cached);
  check(left.length === 0 && s.nodes[s.node]!.cache.length === 0, 'with the rucksack on, he can take the bottles up again');
  check(RunState.safeParse(s).success, 'the state is still sound after all that');
}

// ---------------------------------------------------------------- the coins and the photograph
{
  const s = man();
  check(!canLeave(s, content, uidOf(s, 'item.two_coins')) && !canLeave(s, content, uidOf(s, 'item.photograph')), 'he cannot put down the coins or the photograph');
  const after = leaveHere(s, content, uidOf(s, 'item.two_coins'));
  check(after.pack.some((p) => p.item === 'item.two_coins'), 'asking to leave the coins does nothing');
  check(canLeave(s, content, uidOf(s, 'item.l1a1_rifle')), 'he can put down the rifle');
  check(!canLeave(s, content, uidOf(s, 'item.webbing_58')), 'he cannot take off the webbing while there is anything in it');
  const taken = strip(s, content);
  const kept = s.pack.map((p) => p.item).sort();
  check(JSON.stringify(kept) === JSON.stringify(['item.photograph', 'item.two_coins']), 'a looter who strips him leaves the coins and the photograph', `took ${taken.length} things, kept ${kept.join(', ')}`);
}

// ---------------------------------------------------------------- the pram
{
  const s = man();
  place(s, content, 'item.pram', 1, {});
  check(hasPram(s, content) && containers(s, content).cart === 40, 'a pram holds forty kilos');
  place(s, content, 'item.coal_briquettes', 1, {});
  check(s.pack.some((p) => p.item === 'item.coal_briquettes' && p.where === 'cart'), 'what is too heavy for the webbing goes in the pram');
  check(bodyLoad(s, content) < 13, 'what is in the pram does not weigh on him');
  abandonPram(s, content);
  check(!hasPram(s, content) && s.nodes[s.node]!.cache.some((c) => c.item === 'item.coal_briquettes'), 'leaving the road, he leaves the pram and all in it');
}

// ---------------------------------------------------------------- load
{
  const s = man();
  place(s, content, 'item.rucksack', 1, {});
  place(s, content, 'item.coal_briquettes', 1, {});
  check(loadFactor(s, content) > 1.2, 'a heavy load tires him faster', `factor ${loadFactor(s, content).toFixed(2)} at ${bodyLoad(s, content).toFixed(1)} kg`);
}

// ---------------------------------------------------------------- boots
{
  let hurt = 0;
  for (let seed = 0; seed < 100; seed++) {
    const s = man();
    const rng = new Rng(seed);
    for (let d = 0; d < 30; d++) wearBoots(s, content, 5, rng);
    const boots = s.pack.find((p) => p.item === 'item.dms_boots')!;
    if (boots.condition === 0 && s.body.wounds.some((w) => w.location.endsWith('foot'))) hurt++;
  }
  check(hurt > 80, 'a month of walking wears his boots through and the road gets at his feet', `${hurt}/100`);
  const s = man();
  wearBoots(s, content, 5, new Rng(1));
  check(s.pack.find((p) => p.item === 'item.dms_boots')!.condition === 50 - 5 * PACK.bootWearPerHour, 'a day of walking wears them a little');
}

// ---------------------------------------------------------------- tins
{
  const keys: Record<string, number> = {};
  for (let seed = 0; seed < 400; seed++) {
    const s = man();
    place(s, content, 'item.unlabelled_tin', 1, { rng: new Rng(seed) });
    const tin = s.pack.find((p) => p.item === 'item.unlabelled_tin')!;
    keys[tin.secret!] = (keys[tin.secret!] ?? 0) + 1;
    if (seed === 0) {
      const kcal = s.today.kcal;
      const text = tend(s, content, `eat:${tin.uid}`, 0).join(' ');
      const c = itemOf(content, 'item.unlabelled_tin').food!.contents!.find((x) => x.key === tin.secret)!;
      check(s.today.kcal - kcal === c.kcal && text.includes(c.text), 'opening a tin shows what was in it and feeds him by that', `${tin.secret}, ${c.kcal} kcal`);
    }
  }
  check(Object.keys(keys).length >= 6, 'tins hold all sorts', JSON.stringify(keys));
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll pack checks passed.');
process.exit(failures ? 1 : 0);
