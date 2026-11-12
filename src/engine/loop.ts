/**
 * The day loop: dawn → plan → move → inspect → loot → tend → night → dawn.
 *
 * Two pure functions drive everything:
 *   choices(state, content)      what he can do now
 *   act(state, content, choice)  → the next state and the prose it produced
 *
 * Nothing here touches the page or storage, so the same loop runs in the
 * browser, in tests and in the balance simulator.
 *
 * Text in [square brackets] is placeholder. The style linter will refuse
 * a release build that still contains any.
 */
import type { RunState } from '../schema/run-state.js';
import {
  bodyHours, canWalk, checkDeath, dawnStatus, exposeDay, freshDay, searchFatigue, sleepAndReckon, tend,
  tendChoices,
} from './body.js';
import { daylight, proseDate, shortDate } from './calendar.js';
import { type Content, type LootDef, itemOf, templateOf } from './content.js';
import { HOURS, revealAround } from './map.js';
import { paragraph, phrase } from './phrases.js';
import { inline, kindName, resolve } from './prose.js';
import { hash, Rng } from './rng.js';
import { nextWeather, weatherHours } from './weather.js';
import {
  checkHold, dawnIntrusion, holdOvernight, lookAtPhotograph, maybeUncanny, misread, nightVoice, photographChoice, wander,
} from './hold.js';

export interface Choice {
  id: string;
  label: string;
  /** Hours, after dark, already searched: shown small after the label. */
  note?: string;
}

export interface Outcome {
  state: RunState;
  /** Paragraphs to add to the page. */
  text: string[];
}

/** Hooks for systems still to come. Each is a seeded chance and a placeholder. */
const HOOKS = {
  encounterOnMove: 0.15,
  encounterOnLoot: 0.1,
  encounterAtNight: 0.05,
  dream: 1 / 3,
};

const AFTER_DARK = 1.5;

// ================================================================ what he sees

/** The paragraphs that open a phase. Used at dawn and after loading a save. */
export function opening(state: RunState, content: Content): string[] {
  if (state.ended) return [];
  switch (state.phase) {
    case 'dawn':
      return [
        dawnIntrusion(state, content) ?? '',
        phrase(content, state, `weather.${state.weather.kind}`),
        paragraph(dawnStatus(state, content)),
      ].filter(Boolean);
    case 'plan':
      return [resolve(templateOf(content, here(state).template).glance, state.hold)];
    default:
      return [];
  }
}

export function heading(state: RunState): string {
  return `${shortDate(state.day)}`;
}

// ================================================================ choices

export function choices(state: RunState, content: Content): Choice[] {
  if (state.ended) return [];
  const node = here(state);
  const tpl = templateOf(content, node.template);
  const dark = state.hoursLeft <= 0;

  switch (state.phase) {
    case 'dawn':
      return [{ id: 'go', label: 'Get up.' }];

    case 'plan': {
      const out: Choice[] = [{ id: 'stay', label: 'Stay here today.' }];
      if (!canWalk(state)) return [{ ...out[0]!, note: 'too spent to walk' }];
      for (const l of node.links) {
        const dest = state.nodes[l.to]!;
        const name = kindName(templateOf(content, dest.template).kind);
        const back = dest.known === 'visited' ? 'Go back to' : 'Make for';
        out.push({ id: `move:${l.to}`, label: `${back} ${name}.`, note: hoursNote(moveHours(state, l.hours), dark) });
      }
      return out;
    }

    case 'inspect': {
      if (!node.inspected)
        return [
          { id: 'look', label: 'Look the place over.', note: hoursNote(1, dark) },
          { id: 'rest', label: 'Leave it and see to himself.' },
        ];
      const out: Choice[] = tpl.pois
        .filter((p) => node.searched[p.key] !== 'thorough')
        .map((p) => ({ id: `poi:${p.key}`, label: p.label, note: node.searched[p.key] ? 'searched once' : undefined }));
      out.push({ id: 'rest', label: 'Search nothing more today.' });
      return out;
    }

    case 'loot': {
      const out: Choice[] = [];
      if (!node.searched[state.focus!]) out.push({ id: 'search:quick', label: 'Search it quickly.', note: hoursNote(1, dark) });
      out.push({ id: 'search:thorough', label: 'Search it thoroughly.', note: `${hoursNote(2, dark)}, noise` });
      out.push({ id: 'back', label: 'Leave it.' });
      return out;
    }

    case 'tend': {
      const photo = photographChoice(state);
      return [...tendChoices(state, content), ...(photo ? [photo] : []), { id: 'night', label: 'Make ready for the night.' }];
    }

    case 'night': {
      const out: Choice[] = [];
      const shelters = tpl.pois.filter((p) => p.shelter);
      if (state.today.fire) {
        for (const p of shelters) {
          const where = inline(p.label);
          out.push(
            p.shelter!.fireAllowed
              ? { id: `sleep:${p.key}`, label: `Sleep by the fire in ${where}.` }
              : { id: `sleep:${p.key}`, label: `Sleep in ${where} and let the fire burn down.` },
          );
        }
        out.push({ id: 'sleep:open', label: 'Sleep by the fire in the open.' });
      } else {
        const fire = tendChoices(state, content).find((c) => c.id === 'fire');
        if (fire) out.push({ id: 'fire', label: 'Make a fire first.' });
        for (const p of shelters) out.push({ id: `sleep:${p.key}`, label: `Sleep in ${inline(p.label)}.` });
        out.push({ id: 'sleep:open', label: 'Sleep in the open.' });
      }
      return out;
    }

    default:
      return [];
  }
}

// ================================================================ acting

export function act(prev: RunState, content: Content, choiceId: string): Outcome {
  if (!choices(prev, content).some((c) => c.id === choiceId))
    throw new Error(`"${choiceId}" is not a choice on day ${prev.day} at ${prev.phase}`);

  const state = structuredClone(prev);
  const text: string[] = [];
  const events = new Rng(state.rng.events);
  const [verb, a] = choiceId.split(':');

  switch (state.phase) {
    case 'dawn':
      state.phase = 'plan';
      text.push(...opening(state, content));
      break;

    case 'plan':
      if (verb === 'stay') {
        text.push('[He stays where he is today.]');
        state.phase = 'tend';
        break;
      }
      move(state, content, a!, text, events);
      break;

    case 'inspect':
      if (verb === 'look') {
        spend(state, 1);
        exposeDay(state, content, 1, false);
        here(state).inspected = true;
        text.push(resolve(templateOf(content, here(state).template).inspect, state.hold));
        text.push(...maybeUncanny(state, content, 'inspect', events));
      } else if (verb === 'poi') {
        state.focus = a;
        state.phase = 'loot';
      } else {
        state.phase = 'tend';
      }
      break;

    case 'loot':
      if (verb === 'back') {
        delete state.focus;
        state.phase = 'inspect';
        break;
      }
      search(state, content, a as 'quick' | 'thorough', text, events);
      if (events.chance(HOOKS.encounterOnLoot)) text.push('[An encounter would fire here, while he searches.]');
      delete state.focus;
      state.phase = 'tend';
      break;

    case 'tend':
      if (verb === 'night') {
        text.push(...maybeUncanny(state, content, 'tend', events));
        state.phase = 'night';
      } else if (verb === 'photograph') text.push(...lookAtPhotograph(state, content));
      else text.push(...tend(state, content, choiceId, state.pack.length + state.hoursLeft));
      break;

    case 'night':
      if (verb === 'fire') {
        text.push(...tend(state, content, 'fire', 0));
        break;
      }
      sleep(state, content, a!, text, events);
      break;
  }

  checkDeath(state);
  checkHold(state);
  if (state.ended?.ending === 'death') text.push(epitaph(state, content));
  if (state.ended?.ending === 'long_walk')
    text.push('[The Long Walk. Told from outside for the first time: a man walking into the fog with a column no one else can see. Written at Stage 9.]');

  state.rng.events = events.state;
  return { state, text };
}

// ================================================================ phases

function move(state: RunState, content: Content, chosen: string, text: string[], events: Rng) {
  const to = wander(state, chosen, events);
  if (to !== chosen) text.push(phrase(content, state, 'hold.wandered'));
  const link = here(state).links.find((l) => l.to === to)!;
  const hours = moveHours(state, link.hours);
  const dark = state.hoursLeft - hours < 0;
  spend(state, hours);
  exposeDay(state, content, hours, true, link.terrain === 'forest' || link.terrain === 'rubble' ? hours * 0.25 : 0);

  text.push(`[He walks ${hours} hours by ${link.terrain}${dark ? ', the last of it in the dark' : ''}.]`);
  if (events.chance(HOOKS.encounterOnMove)) text.push('[An encounter would fire here, on the way.]');

  state.node = to;
  revealAround(state.nodes, to);
  const tpl = templateOf(content, here(state).template);
  text.push(resolve(tpl.glance, state.hold));
  text.push(...maybeUncanny(state, content, 'move', events));

  if (tpl.kind === 'quay') {
    state.ended = { ending: 'crossing', day: state.day };
    text.push('[The Crossing. An old man in a motor launch at the quay, and the two coins. Written at Stage 9.]');
    return;
  }
  state.phase = 'inspect';
}

function search(state: RunState, content: Content, depth: 'quick' | 'thorough', text: string[], events: Rng) {
  const node = here(state);
  const tpl = templateOf(content, node.template);
  const poi = tpl.pois.find((p) => p.key === state.focus)!;
  const first = !node.searched[poi.key];
  const hours = depth === 'quick' ? 1 : 2;

  spend(state, hours);
  searchFatigue(state, hours);
  if (!poi.shelter) exposeDay(state, content, hours, false);
  if (depth === 'thorough') state.noise += 1;
  node.searched[poi.key] = depth;

  if (first && poi.text) text.push(resolve(poi.text, state.hold));

  const found: { item: string; qty: number }[] = [];
  if (first && poi.fixed) found.push(...poi.fixed);
  const table = poi.loot ? content.loot.get(poi.loot) : undefined;
  if (table) found.push(...drawLoot(table, depth, events));

  for (const f of found) give(state, content, f.item, f.qty, table?.contamination ?? 0, events);

  text.push(
    found.length
      ? `[Found: ${found
          .map((f) => {
            const seen = misread(state, f.qty, events); // as he counts it; the pack holds the truth
            return `${itemOf(content, f.item).name}${seen > 1 ? ` ×${seen}` : ''}`;
          })
          .join(', ')}.]`
      : '[He finds nothing of use.]',
  );
}

function sleep(state: RunState, content: Content, where: string, text: string[], events: Rng) {
  const tpl = templateOf(content, here(state).template);
  const poi = tpl.pois.find((p) => p.key === where);
  const quality = poi?.shelter?.quality ?? 0;
  const fire = state.today.fire && (where === 'open' || Boolean(poi?.shelter?.fireAllowed));

  if (events.chance(HOOKS.encounterAtNight)) text.push('[An encounter would fire here, in the night.]');
  text.push(...maybeUncanny(state, content, 'night', events));
  const voice = nightVoice(state, content, events);
  if (voice) text.push(voice);
  const night = sleepAndReckon(state, content, { quality, open: where === 'open', fire }, events);
  text.push(...night.text);
  holdOvernight(state, night.chill, quality);
  if (events.chance(HOOKS.dream)) text.push('[He dreams. Dreams are drawn with the night events.]');
  if (state.ended || state.hold <= 0) return;

  state.day += 1;
  const weather = new Rng(state.rng.weather);
  state.weather = nextWeather(state.weather, state.day, weather);
  state.rng.weather = weather.state;
  state.today = freshDay();
  state.hoursLeft = daylight(state.day);
  state.noise = Math.max(0, state.noise - 1);
  state.phase = 'dawn';
}

function epitaph(state: RunState, content: Content): string {
  const cause = state.ended!.cause;
  const pool = content.all.epitaphs.filter((e) => e.cause === cause);
  const node = here(state);
  const place = `${kindName(templateOf(content, node.template).kind)} in ${content.regions.get(node.region)?.inProse ?? 'the zone'}`;
  if (!pool.length) return `[Epitaph for death by ${cause}, on ${proseDate(state.day)} at ${place}. Not written yet.]`;
  const e = new Rng(hash(`${state.seed}/epitaph`)).weighted(pool, (x) => x.weight);
  return e.text.replace('{date}', proseDate(state.day)).replace('{place}', place);
}

// ================================================================ helpers

function here(state: RunState) {
  return state.nodes[state.node]!;
}

function spend(state: RunState, hours: number) {
  state.hoursLeft = Math.round((state.hoursLeft - hours) * 2) / 2;
}

function moveHours(state: RunState, base: number) {
  const h = base + weatherHours(state.weather) + bodyHours(state);
  return state.hoursLeft <= 0 ? h * AFTER_DARK : h;
}

function hoursNote(hours: number, dark: boolean) {
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}${dark ? ', after dark' : ''}`;
}

function drawLoot(table: LootDef, depth: 'quick' | 'thorough', rng: Rng) {
  const entries = table.entries.filter((e) => depth === 'thorough' || !e.thoroughOnly);
  const out: { item: string; qty: number }[] = [];
  if (!entries.length) return out;
  for (let i = 0; i < table.draws[depth]; i++) {
    const e = rng.weighted(entries, (x) => x.weight);
    const qty = Array.isArray(e.qty) ? rng.int(e.qty[0], e.qty[1]) : e.qty;
    if (qty > 0) out.push({ item: e.item, qty });
  }
  return out;
}

/** Put a find in the pack. Capacity and weight arrive with the pack system. */
function give(state: RunState, content: Content, itemId: string, qty: number, contamination: number, rng: Rng) {
  const def = itemOf(content, itemId);
  const dusty = !def.food?.sealed && rng.chance(contamination);
  const where = 'webbing' as const;
  const same = def.stackable && state.pack.find((p) => p.item === itemId && p.where === where && !p.left);
  if (same) {
    same.qty += qty;
    return;
  }
  const n = state.pack.reduce((m, p) => Math.max(m, Number(p.uid.slice(1)) || 0), 0) + 1;
  const copies = def.stackable ? [qty] : Array.from({ length: qty }, () => 1);
  copies.forEach((q, i) =>
    state.pack.push({
      uid: `p${n + i}`,
      item: itemId,
      qty: q,
      where,
      condition: 100,
      contamination: dusty ? 'unknown' : 'clean',
      ...(def.vessel ? { fill: { litres: 0, water: 'clean' as const } } : {}),
    }),
  );
}

export { HOURS };
