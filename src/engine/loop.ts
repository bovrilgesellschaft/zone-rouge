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
import { daylight, shortDate } from './calendar.js';
import { type Content, type LootDef, itemOf, templateOf } from './content.js';
import { HOURS, revealAround } from './map.js';
import { inline, kindName, resolve } from './prose.js';
import { Rng } from './rng.js';

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

/** Hooks for systems that arrive at Stage 5. Each is a seeded chance and a placeholder. */
const HOOKS = {
  encounterOnMove: 0.15,
  encounterOnLoot: 0.1,
  encounterAtNight: 0.05,
  dream: 1 / 3,
};

const AFTER_DARK = 1.5;

// ================================================================ what he sees

/** The paragraph that opens a phase. Used at dawn and after loading a save. */
export function opening(state: RunState, content: Content): string[] {
  if (state.ended) return [];
  switch (state.phase) {
    case 'dawn':
      return [
        `[Dawn. ${shortDate(state.day)}, day ${state.day}. ${state.hoursLeft} hours of light. His body, the weather and the night’s dream residue come in at Stage 5.]`,
      ];
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

    case 'tend':
      return [{ id: 'night', label: 'Make ready for the night.' }];

    case 'night': {
      const out: Choice[] = [];
      for (const p of tpl.pois.filter((p) => p.shelter)) {
        const where = inline(p.label);
        if (p.shelter!.fireAllowed) out.push({ id: `sleep:${p.key}:fire`, label: `Sleep in ${where}, with a fire.` });
        out.push({ id: `sleep:${p.key}:cold`, label: `Sleep in ${where}, without a fire.` });
      }
      out.push({ id: 'sleep:open:fire', label: 'Sleep in the open, with a fire.' });
      out.push({ id: 'sleep:open:cold', label: 'Sleep in the open, without a fire.' });
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
  const [verb, a, b] = choiceId.split(':');

  switch (state.phase) {
    case 'dawn':
      state.phase = 'plan';
      text.push(...opening(state, content));
      break;

    case 'plan':
      if (verb === 'stay') {
        text.push('[He stays where he is. A day in one place skips Move, Inspect and Loot.]');
        state.phase = 'tend';
        break;
      }
      move(state, content, a!, text, events);
      break;

    case 'inspect':
      if (verb === 'look') {
        spend(state, 1);
        here(state).inspected = true;
        text.push(resolve(templateOf(content, here(state).template).inspect, state.hold));
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
      text.push('[Tend: eating, water, wounds, repairs, crafting and the journal come in at Stage 5.]');
      state.phase = 'night';
      break;

    case 'night':
      sleep(state, content, a!, b === 'fire', text, events);
      break;
  }

  state.rng.events = events.state;
  return { state, text };
}

// ================================================================ phases

function move(state: RunState, content: Content, to: string, text: string[], events: Rng) {
  const link = here(state).links.find((l) => l.to === to)!;
  const hours = moveHours(state, link.hours);
  const dark = state.hoursLeft - hours < 0;
  spend(state, hours);

  text.push(`[He walks ${hours} hours by ${link.terrain}${dark ? ', the last of it in the dark' : ''}.]`);
  if (events.chance(HOOKS.encounterOnMove)) text.push('[An encounter would fire here, on the way.]');

  state.node = to;
  revealAround(state.nodes, to);
  const tpl = templateOf(content, here(state).template);
  text.push(resolve(tpl.glance, state.hold));

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

  spend(state, depth === 'quick' ? 1 : 2);
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
      ? `[Found: ${found.map((f) => `${itemOf(content, f.item).name}${f.qty > 1 ? ` ×${f.qty}` : ''}`).join(', ')}.]`
      : '[He finds nothing of use.]',
  );
}

function sleep(state: RunState, content: Content, where: string, fire: boolean, text: string[], events: Rng) {
  const tpl = templateOf(content, here(state).template);
  const place = where === 'open' ? 'the open' : inline(tpl.pois.find((p) => p.key === where)!.label);
  text.push(`[He sleeps in ${place}${fire ? ' by a fire' : ' without a fire'}. Warmth, rest and Hold come in at Stage 5.]`);
  if (events.chance(HOOKS.encounterAtNight)) text.push('[An encounter would fire here, in the night.]');
  if (events.chance(HOOKS.dream)) text.push('[He dreams. Dreams are drawn at Stage 5.]');

  state.day += 1;
  state.hoursLeft = daylight(state.day);
  state.noise = Math.max(0, state.noise - 1);
  state.phase = 'dawn';
}

// ================================================================ helpers

function here(state: RunState) {
  return state.nodes[state.node]!;
}

function spend(state: RunState, hours: number) {
  state.hoursLeft = Math.round((state.hoursLeft - hours) * 2) / 2;
}

function moveHours(state: RunState, base: number) {
  return state.hoursLeft <= 0 ? base * AFTER_DARK : base;
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
  const same = def.stackable && state.pack.find((p) => p.item === itemId && p.where === where);
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
