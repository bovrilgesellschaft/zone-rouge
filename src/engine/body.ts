/**
 * The body: four needs, wounds, illness, and death.
 *
 * Needs run 0 (fine) to 100 (dead) in five bands of twenty. Below
 * `wanting` they cost him: slower walking, poorer sleep. A need that
 * reaches 100 kills him; the dying band (80–99) gives one to three days.
 *
 * All tuning numbers are here, in one place, for Stage 7 to adjust.
 */
import type { RunState } from '../schema/run-state.js';
import type { Content } from './content.js';
import { itemOf, templateOf } from './content.js';
import { phrase } from './phrases.js';
import type { Rng } from './rng.js';
import { soaking } from './weather.js';

export const TUNING = {
  kcalPerDay: 2200,
  kcalPerHourWalked: 150,
  kcalExtraWhenCold: 300,
  /** Hunger rises one point per this many kcal short of need. */
  kcalPerHungerPoint: 700,
  /** And falls one point per this many kcal over. */
  kcalPerHungerRelief: 300,
  litresPerDay: 2.5,
  thirstPerLitreShort: 14,
  thirstReliefPerLitreOver: 20,
  feverThirst: 10,
  fatiguePerHourWalked: 3,
  fatiguePerHourSearching: 2,
  sleepRecovery: 55,
  restRecovery: 12,
  shelterSleep: [0.4, 0.6, 0.8, 1],
};

export type Need = 'hunger' | 'thirst' | 'cold' | 'fatigue';
export const NEEDS: Need[] = ['hunger', 'thirst', 'cold', 'fatigue'];
export const BANDS = ['fine', 'wanting', 'suffering', 'failing', 'dying'] as const;
export type Band = (typeof BANDS)[number];

export function band(v: number): Band {
  return BANDS[Math.min(4, Math.max(0, Math.floor(v / 20)))]!;
}

const clamp = (v: number) => Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;

export function clampNeeds(state: RunState) {
  for (const n of NEEDS) state.body[n] = clamp(state.body[n]);
}

// ================================================================ clothing and cold

export function insulation(state: RunState, content: Content): { warmth: number; waterproof: boolean } {
  let warmth = 0;
  let waterproof = false;
  for (const p of state.pack.filter((p) => p.where === 'worn')) {
    const wear = itemOf(content, p.item).wear;
    if (!wear) continue;
    warmth += p.condition < 40 ? Math.max(0, wear.warmth - 1) : wear.warmth;
    if (wear.waterproof && (wear.slot === 'over' || wear.slot === 'body_outer')) waterproof = true;
  }
  return { warmth, waterproof };
}

/**
 * Hours spent outdoors in the day. Walking keeps him warmer than standing.
 * Wet clothes are the classic killer.
 */
export function exposeDay(state: RunState, content: Content, hours: number, moving: boolean, extraFatigue = 0) {
  const w = state.weather;
  const { warmth, waterproof } = insulation(state, content);
  if (soaking(w) && !waterproof && hours >= 1) state.body.wet = true;
  if (w.kind === 'snow' && hours >= 4 && !waterproof) state.body.wet = true;

  const chill = -w.tempC + w.wind * 2 + 6 - warmth * 2 + (state.body.wet ? 10 : 0) - (moving ? 8 : 0);
  if (chill > 0) state.body.cold += (chill / 4) * hours;

  if (moving) {
    state.today.walked += hours;
    state.body.fatigue += hours * (TUNING.fatiguePerHourWalked + w.snow * 0.25) + extraFatigue;
  } else {
    state.today.idle += hours;
  }
  clampNeeds(state);
}

export function searchFatigue(state: RunState, hours: number) {
  state.body.fatigue += hours * TUNING.fatiguePerHourSearching;
  clampNeeds(state);
}

/** Extra hours on a walk when he is spent. */
export function bodyHours(state: RunState): number {
  return band(state.body.fatigue) === 'failing' ? 1 : 0;
}

export function canWalk(state: RunState): boolean {
  return band(state.body.fatigue) !== 'dying';
}

// ================================================================ the night

export interface Night {
  quality: number; // shelter 0–3
  open: boolean;
  fire: boolean;
}

/** The night's sleep, then the day's accounts: food, water, wounds, illness. Returns prose and how cold the night was. */
export function sleepAndReckon(state: RunState, content: Content, night: Night, events: Rng): { text: string[]; chill: number } {
  const text: string[] = [];
  const b = state.body;
  const w = state.weather;
  const { warmth } = insulation(state, content);
  const fever = b.illnesses.some((i) => i.kind === 'fever');

  // A fire dries his clothes early in the night.
  if (night.fire) b.wet = false;
  // Cold through the night. Sleeping still, clothes count for less than walking.
  const chill =
    -w.tempC + (night.quality < 2 ? w.wind * 2 : 0) + 20 - warmth * 2 - night.quality * 6 - (night.fire ? 15 : 0) + (b.wet ? 10 : 0);
  if (chill > 0) b.cold += chill * 1.5;
  else b.cold = Math.max(0, b.cold - (-chill * 2 + 5));
  if (night.quality >= 2 && events.chance(0.5)) b.wet = false;

  // Sleep.
  let q = TUNING.shelterSleep[night.quality]!;
  if (chill > 10) q *= 0.5;
  else if (chill > 0) q *= 0.75;
  if (fever) q *= 0.6;
  if (band(b.hunger) === 'failing' || band(b.hunger) === 'dying') q *= 0.8;
  b.fatigue -= TUNING.sleepRecovery * q;
  if (state.today.walked === 0) b.fatigue -= TUNING.restRecovery;

  text.push(phrase(content, state, chill > 12 ? 'night.freezing' : chill > 0 ? 'night.cold' : 'night.warm'));

  // Food.
  const need = TUNING.kcalPerDay + state.today.walked * TUNING.kcalPerHourWalked + (b.cold >= 40 ? TUNING.kcalExtraWhenCold : 0);
  const short = need - state.today.kcal;
  b.hunger += short > 0 ? short / TUNING.kcalPerHungerPoint : short / TUNING.kcalPerHungerRelief;
  b.deficitKcal = Math.max(0, b.deficitKcal + short);

  // Water.
  const dry = TUNING.litresPerDay - state.today.litres;
  b.thirst += dry > 0 ? dry * TUNING.thirstPerLitreShort : dry * TUNING.thirstReliefPerLitreOver;
  if (fever) b.thirst += TUNING.feverThirst;

  woundsOvernight(state, events);
  illnessOvernight(state, chill, events);
  clampNeeds(state);
  return { text, chill };
}

// ================================================================ wounds and illness

function woundsOvernight(state: RunState, rng: Rng) {
  const b = state.body;
  const days = (w: { since: number }) => state.day - w.since;
  const up = { light: 'serious', serious: 'grave', grave: 'grave' } as const;

  for (const w of b.wounds) {
    switch (w.state) {
      case 'clean':
        if (w.dressed && days(w) >= 2) Object.assign(w, { state: 'healing', since: state.day });
        else if (!w.dressed && rng.chance(0.15)) Object.assign(w, { state: 'dirty', since: state.day });
        break;
      case 'dirty':
        if (rng.chance(w.dressed ? 0.2 : 0.35)) Object.assign(w, { state: 'infected', since: state.day });
        break;
      case 'infected':
        if (rng.chance(state.today.antiseptic ? 0.35 : 0.08)) Object.assign(w, { state: 'healing', since: state.day });
        else if (w.severity === 'grave' && rng.chance(0.4)) die(state, 'infection');
        else if (rng.chance(0.2)) w.severity = up[w.severity];
        break;
      case 'healing':
        if (days(w) >= 6) Object.assign(w, { state: 'scarred', since: state.day });
        break;
    }
  }
  // A light wound that has healed leaves nothing worth recording.
  b.wounds = b.wounds.filter((w) => !(w.state === 'scarred' && w.severity === 'light' && !w.note));

  const infected = b.wounds.some((w) => w.state === 'infected');
  const hasFever = b.illnesses.some((i) => i.kind === 'fever');
  if (infected && !hasFever) b.illnesses.push({ kind: 'fever', since: state.day, severity: 1 });
  if (!infected && hasFever) b.illnesses = b.illnesses.filter((i) => i.kind !== 'fever');
}

function illnessOvernight(state: RunState, nightChill: number, rng: Rng) {
  const b = state.body;
  const pneu = b.illnesses.find((i) => i.kind === 'pneumonia');
  if (!pneu) {
    // The cough he came out of the cabin with can settle on the chest.
    const risk = (state.flags['body.cough'] ? 0.1 : 0.04) * (b.cold >= 50 ? 1 : 0) * (b.wet ? 1.5 : 1);
    if (rng.chance(risk)) b.illnesses.push({ kind: 'pneumonia', since: state.day, severity: 1 });
    return;
  }
  b.fatigue += 8;
  if (nightChill <= 0 && rng.chance(0.4)) pneu.severity -= 1;
  else if (nightChill > 0 && rng.chance(0.3)) pneu.severity += 1;
  if (pneu.severity <= 0) b.illnesses = b.illnesses.filter((i) => i !== pneu);
  else if (pneu.severity > 3) die(state, 'illness');
}

// ================================================================ death

export type Cause = 'hunger' | 'thirst' | 'cold' | 'infection' | 'illness';

function die(state: RunState, cause: Cause) {
  state.ended ??= { ending: 'death', day: state.day, cause };
}

/** Call after anything that changes the body. */
export function checkDeath(state: RunState) {
  if (state.ended) return;
  const b = state.body;
  if (b.cold >= 100) die(state, 'cold');
  else if (b.thirst >= 100) die(state, 'thirst');
  else if (b.hunger >= 100) die(state, 'hunger');
}

// ================================================================ dawn

/** The body part of the dawn paragraph: the worst two needs, wet, fever, the worst wound. */
export function dawnStatus(state: RunState, content: Content): string[] {
  const b = state.body;
  const out: string[] = [];
  const pressing = NEEDS.filter((n) => band(b[n]) !== 'fine')
    .sort((x, y) => b[y] - b[x])
    .slice(0, 2);
  for (const n of pressing) out.push(phrase(content, state, `status.${n}.${band(b[n]) as Exclude<Band, 'fine'>}`));
  if (b.wet) out.push(phrase(content, state, 'status.wet'));
  if (b.illnesses.some((i) => i.kind === 'pneumonia')) out.push(phrase(content, state, 'status.pneumonia'));
  else if (b.illnesses.some((i) => i.kind === 'fever')) out.push(phrase(content, state, 'status.fever'));

  const worst =
    b.wounds.find((w) => w.state === 'infected' && w.severity === 'grave') ??
    b.wounds.find((w) => w.state === 'infected') ??
    b.wounds.find((w) => w.state === 'dirty');
  if (worst) {
    const slot = worst.state === 'dirty' ? 'status.wound.dirty' : worst.severity === 'grave' ? 'status.wound.grave' : 'status.wound.infected';
    out.push(phrase(content, state, slot, { location: LOCATION[worst.location] }));
  }
  return out;
}

export const LOCATION: Record<RunState['body']['wounds'][number]['location'], string> = {
  head: 'head', chest: 'chest', belly: 'belly', back: 'back', left_arm: 'left arm', right_arm: 'right arm',
  left_hand: 'left hand', right_hand: 'right hand', left_leg: 'left leg', right_leg: 'right leg',
  left_foot: 'left foot', right_foot: 'right foot',
};

// ================================================================ tend

export interface TendChoice {
  id: string;
  label: string;
  note?: string;
}

type Carried = RunState['pack'][number];

const hasTag = (content: Content, p: Carried, tag: string) => (itemOf(content, p.item).tags ?? []).includes(tag);
const find = (state: RunState, content: Content, test: (p: Carried) => boolean) => state.pack.find(test);

/** Is there wood to burn here? Everywhere for now; some places will lack it once fuel is tracked. */
function fuelHere(state: RunState, content: Content) {
  return templateOf(content, state.nodes[state.node]!.template).kind !== 'quay';
}

function fireStarter(state: RunState, content: Content) {
  return find(state, content, (p) => hasTag(content, p, 'fire_starter'));
}

function stoveAndBlock(state: RunState, content: Content) {
  const stove = find(state, content, (p) => p.item === 'item.hexamine_stove');
  const block = find(state, content, (p) => p.item === 'item.hexamine_block');
  return stove && block ? block : undefined;
}

/** Something to cook on: the fire, or the stove and a block. */
function canCook(state: RunState, content: Content) {
  return state.today.fire || Boolean(stoveAndBlock(state, content));
}

function useOne(state: RunState, p: Carried) {
  p.qty -= 1;
  if (p.qty <= 0) state.pack = state.pack.filter((x) => x !== p);
}

function waterSources(state: RunState, content: Content) {
  const vessels = state.pack.filter((p) => p.fill && p.fill.litres > 0);
  const bottles = state.pack.filter((p) => itemOf(content, p.item).drink && !itemOf(content, p.item).drink!.alcohol);
  const order = { clean: 0, unknown: 1, contaminated: 2 } as const;
  return [...vessels.sort((a, b) => order[a.fill!.water] - order[b.fill!.water]), ...bottles];
}

export function tendChoices(state: RunState, content: Content): TendChoice[] {
  const out: TendChoice[] = [];
  const cook = canCook(state, content);

  // Food, one line per kind of food he carries.
  const seen = new Set<string>();
  for (const p of state.pack) {
    const def = itemOf(content, p.item);
    if (!def.food || seen.has(p.item)) continue;
    seen.add(p.item);
    if (def.food.needsCooking && !cook) continue;
    const name = def.name.replace(/^(a|an|the) /, '');
    const kcal = def.food.kcal * (p.left ?? 1);
    out.push({ id: `eat:${p.uid}`, label: `Eat the ${name}.` });
    if (kcal >= 600) out.push({ id: `half:${p.uid}`, label: `Eat half the ${name}.` });
  }

  if (waterSources(state, content).length && state.today.litres < 3) out.push({ id: 'drink', label: 'Drink.' });

  const room = state.pack.some((p) => p.fill && p.fill.litres < itemOf(content, p.item).vessel!.litres);
  if ((state.weather.snow > 0 || state.weather.kind === 'snow') && room && cook)
    out.push({ id: 'melt', label: 'Melt snow for water.', note: state.today.fire ? '1 hour' : '1 hour, a hexamine block' });

  if (!state.today.fire && fireStarter(state, content) && fuelHere(state, content))
    out.push({ id: 'fire', label: 'Make a fire.' });

  const dressing = find(state, content, (p) => p.item === 'item.field_dressing' || hasTag(content, p, 'bandage'));
  const water = waterSources(state, content).length > 0;
  const spirit = find(state, content, (p) => hasTag(content, p, 'antiseptic'));
  for (const w of state.body.wounds) {
    if (w.state === 'scarred' || w.state === 'healing') continue;
    const where = LOCATION[w.location];
    if (w.state === 'dirty' && state.today.fire && water) out.push({ id: `clean:${w.uid}`, label: `Wash out the wound on his ${where}.` });
    if (!w.dressed && dressing) out.push({ id: `dress:${w.uid}`, label: `Dress the wound on his ${where}.` });
    if (w.state === 'infected' && spirit && !state.today.antiseptic)
      out.push({ id: `spirit:${w.uid}`, label: `Pour spirit into the wound on his ${where}.` });
  }
  return out;
}

/** Apply one tend choice. Returns the prose. */
export function tend(state: RunState, content: Content, id: string, n: number): string[] {
  const [verb, ref] = id.split(':');
  const salt = String(n);
  const byUid = (uid?: string) => state.pack.find((p) => p.uid === uid)!;

  switch (verb) {
    case 'eat':
    case 'half': {
      const p = byUid(ref);
      const def = itemOf(content, p.item);
      const food = def.food!;
      const share = verb === 'half' ? 0.5 * (p.left ?? 1) : (p.left ?? 1);
      state.today.kcal += food.kcal * share;
      if (food.needsCooking && !state.today.fire) useOne(state, stoveAndBlock(state, content)!);
      const left = (p.left ?? 1) - share;
      if (left <= 0.01) {
        delete p.left;
        useOne(state, p);
      } else p.left = Math.round(left * 100) / 100;
      const name = def.name.replace(/^(a|an) /, 'the ');
      return [phrase(content, state, food.needsCooking ? 'tend.eat_cooked' : 'tend.eat', { food: name }, salt)];
    }

    case 'drink': {
      let want = Math.min(1, 3 - state.today.litres);
      let from = '';
      for (const p of waterSources(state, content)) {
        if (want <= 0) break;
        const def = itemOf(content, p.item);
        if (p.fill) {
          const take = Math.min(want, p.fill.litres);
          p.fill.litres = Math.round((p.fill.litres - take) * 100) / 100;
          want -= take;
          state.today.litres += take;
        } else if (def.drink) {
          const inBottle = def.drink.litres * (p.left ?? 1);
          const take = Math.min(want, inBottle);
          const left = (inBottle - take) / def.drink.litres;
          want -= take;
          state.today.litres += take;
          if (left <= 0.01) {
            delete p.left;
            useOne(state, p);
          } else if (p.qty > 1) {
            // Open one bottle from the stack.
            p.qty -= 1;
            state.pack.push({ ...p, uid: nextUid(state), qty: 1, left: Math.round(left * 100) / 100 });
          } else p.left = Math.round(left * 100) / 100;
        }
        from ||= def.name.replace(/^(a|an) /, 'the ');
      }
      return [phrase(content, state, 'tend.drink', { vessel: from }, salt)];
    }

    case 'melt': {
      state.hoursLeft -= 1;
      let litres = state.today.fire ? Infinity : 0.5;
      if (!state.today.fire) useOne(state, stoveAndBlock(state, content)!);
      for (const p of state.pack.filter((p) => p.fill)) {
        const cap = itemOf(content, p.item).vessel!.litres;
        const add = Math.min(litres, cap - p.fill!.litres);
        if (add <= 0) continue;
        // Snow water is suspect until the radiation system says otherwise.
        p.fill!.water = 'unknown';
        p.fill!.litres = Math.round((p.fill!.litres + add) * 100) / 100;
        litres -= add;
      }
      return [phrase(content, state, 'tend.melt_snow', {}, salt)];
    }

    case 'fire':
      state.today.fire = true;
      return [phrase(content, state, 'tend.fire', {}, salt)];

    case 'dress':
    case 'clean':
    case 'spirit': {
      const w = state.body.wounds.find((x) => x.uid === ref)!;
      const where = LOCATION[w.location];
      if (verb === 'dress') {
        const d =
          find(state, content, (p) => hasTag(content, p, 'bandage')) ?? find(state, content, (p) => p.item === 'item.field_dressing')!;
        useOne(state, d);
        w.dressed = true;
        return [phrase(content, state, 'tend.dress', { location: where }, salt)];
      }
      if (verb === 'clean') {
        drawWater(state, content, 0.3); // the water goes on the wound, not into him
        Object.assign(w, { state: 'clean', since: state.day, dressed: false });
        return [phrase(content, state, 'tend.clean_wound', { location: where }, salt)];
      }
      const s = find(state, content, (p) => hasTag(content, p, 'antiseptic'))!;
      useOne(state, s);
      state.today.antiseptic = true;
      return [phrase(content, state, 'tend.spirit', { location: where }, salt)];
    }
  }
  return [];
}

function drawWater(state: RunState, content: Content, litres: number) {
  let want = litres;
  for (const p of waterSources(state, content)) {
    if (want <= 0 || !p.fill) continue;
    const take = Math.min(want, p.fill.litres);
    p.fill.litres = Math.round((p.fill.litres - take) * 100) / 100;
    want -= take;
  }
}

export function nextUid(state: RunState): string {
  return `p${state.pack.reduce((m, p) => Math.max(m, Number(p.uid.slice(1)) || 0), 0) + 1}`;
}

export function freshDay(): RunState['today'] {
  return { kcal: 0, litres: 0, walked: 0, idle: 0, fire: false, antiseptic: false, photograph: false };
}
