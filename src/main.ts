/**
 * The page. Everything here is presentation: the engine decides what
 * happens, this file shows it and passes choices back.
 */
import './ui/style.css';
import { shortDate } from './engine/calendar.js';
import { loadContent, itemOf, templateOf } from './engine/content.js';
import { act, choices, heading, opening, type Choice } from './engine/loop.js';
import { kindName, resolve } from './engine/prose.js';
import { band, dawnStatus, LOCATION, NEEDS } from './engine/body.js';
import { randomSeed } from './engine/rng.js';
import { newRun } from './engine/run.js';
import { clearRun, exportSave, importSave, loadRun, saveRun, type Store } from './engine/save.js';
import type { RunState } from './schema/run-state.js';

// ---------------------------------------------------------------- content

const raw = import.meta.glob('../content/**/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;
const content = loadContent(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.replace(/^.*\/content\//, ''), v])));

// ---------------------------------------------------------------- state of the page

type Line = { kind: 'p' | 'chosen' | 'rule'; text?: string; fresh?: boolean };
type UiChoice = Choice & { run?: () => void };

let run: RunState | undefined;
/** The save string always holds the last dawn, matching the autosave. */
let lastDawn: RunState | undefined;
let lines: Line[] = [];
let uiChoices: UiChoice[] | undefined; // title screen and endings

const store: Store | undefined = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const prose = $('prose');
const list = $('choices');
const when = $('when');
const drawerNav = $('drawers');
const drawer = $('drawer');
const drawerTitle = $('drawer-title');
const drawerBody = $('drawer-body');

// ---------------------------------------------------------------- screens

function titleScreen(message?: string) {
  run = undefined;
  const saved = loadRun(store);
  lines = [];
  uiChoices = [
    ...(saved
      ? [{ id: 'continue', label: 'Go on with the walk.', note: `day ${saved.day}, ${shortDate(saved.day)}`, run: () => begin(saved, false) }]
      : []),
    { id: 'new', label: saved ? 'Begin a new walk.' : 'Begin.', run: () => begin(newRun(seedValue(), content), true) },
    { id: 'load', label: 'Load a save string.', run: () => openDrawer('save') },
  ];
  render(message);
}

function seedValue(): string {
  const input = document.getElementById('seed') as HTMLInputElement | null;
  const v = input?.value.trim().toUpperCase();
  return v || randomSeed();
}

function begin(state: RunState, fresh: boolean) {
  run = state;
  lastDawn = state;
  uiChoices = undefined;
  lines = paragraphs(opening(state, content));
  if (fresh) saveRun(store, state);
  render();
  window.scrollTo({ top: 0 });
}

function choose(c: UiChoice) {
  if (c.run) return c.run();
  if (!run) return;

  const prev = run;
  const outcome = act(prev, content, c.id);
  run = outcome.state;

  if (prev.phase === 'dawn') lines = []; // a new page for each day
  lines.forEach((l) => (l.fresh = false));
  lines.push({ kind: 'chosen', text: c.label.replace(/\.$/, '') });
  lines.push(...paragraphs(outcome.text));

  if (run.ended) {
    clearRun(store);
    uiChoices = [{ id: 'again', label: 'Begin again.', run: () => titleScreen() }];
  } else if (run.phase === 'dawn') {
    lastDawn = run;
    saveRun(store, run); // autosave at each dawn
    lines.push({ kind: 'rule' }, ...paragraphs(opening(run, content)));
  }
  render();
}

function paragraphs(text: string[]): Line[] {
  return text.flatMap((t) => t.split(/\n{2,}/)).map((t) => ({ kind: 'p' as const, text: t.trim(), fresh: true }));
}

// ---------------------------------------------------------------- render

function render(message?: string) {
  const current: UiChoice[] = uiChoices ?? (run ? choices(run, content) : []);
  when.textContent = run ? `${heading(run)} · day ${run.day}` : 'Lorraine, January 1984';
  drawerNav.hidden = !run;

  prose.replaceChildren();
  if (!run && !lines.length) {
    prose.append(
      el('p', 'sub', 'A survival roguelike · skeleton build'),
      el('h1', '', 'Zone Rouge'),
      el(
        'p',
        '',
        'A British reservist opens the door of a hunting cabin in the Pays de Bitche, two weeks after the exchange, and walks west toward the sea.',
      ),
      el(
        'p',
        'placeholder',
        '[Stage 4. The day loop runs end to end on placeholder text. Body, weather, Hold, encounters and the rest arrive one at a time at Stage 5.]',
      ),
    );
    if (message) prose.append(el('p', 'placeholder', message));
    const seed = document.createElement('label');
    seed.className = 'seed';
    seed.htmlFor = 'seed';
    seed.append('Seed');
    const input = document.createElement('input');
    input.id = 'seed';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'random';
    input.maxLength = 24;
    seed.append(input);
    prose.append(seed);
  }

  for (const l of lines) {
    if (l.kind === 'rule') {
      prose.append(document.createElement('hr'));
      continue;
    }
    const cls = [l.kind === 'chosen' ? 'chosen' : '', l.text?.startsWith('[') ? 'placeholder' : '', l.fresh ? 'new' : '']
      .filter(Boolean)
      .join(' ');
    prose.append(el('p', cls, l.text ?? ''));
  }

  list.replaceChildren(
    ...current.map((c, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.id = `choice-${c.id.replace(/[^a-z0-9-]/gi, '-')}`;
      b.append(el('span', 'n', i < 9 ? String(i + 1) : '·'));
      const label = el('span', 'label', c.label);
      if (c.note) label.append(el('span', 'note', c.note));
      b.append(label);
      b.addEventListener('click', () => choose(c));
      li.append(b);
      return li;
    }),
  );

  const fresh = prose.querySelector('p.new');
  if (fresh && run) fresh.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (!drawer.hidden && openName) openDrawer(openName);
}

function el(tag: string, cls: string, text: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
}

// ---------------------------------------------------------------- drawers

/** The plain-numbers toggle. A per-viewer setting, kept in this browser. */
const NUMBERS_KEY = 'zone-rouge/show-numbers';
function showNumbers(): boolean {
  try {
    return store?.getItem(NUMBERS_KEY) === '1';
  } catch {
    return false;
  }
}
function setShowNumbers(on: boolean) {
  try {
    store?.setItem(NUMBERS_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable: the setting lasts until the page closes */
  }
}

type DrawerName = 'pack' | 'body' | 'journal' | 'map' | 'save';
let openName: DrawerName | undefined;

const WHERE_ORDER = ['hands', 'worn', 'webbing', 'pockets', 'rucksack', 'cart'] as const;
const WHERE_NAMES: Record<string, string> = {
  hands: 'In his hands',
  worn: 'Worn',
  webbing: 'Webbing',
  pockets: 'Pockets',
  rucksack: 'Rucksack',
  cart: 'Cart',
};

function openDrawer(name: DrawerName) {
  openName = name;
  drawer.hidden = false;
  drawerNav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.drawer === name)));
  drawerBody.replaceChildren();

  if (name === 'pack') {
    drawerTitle.textContent = 'Pack';
    if (!run) return;
    for (const where of WHERE_ORDER) {
      const items = run.pack.filter((p) => p.where === where);
      if (!items.length) continue;
      drawerBody.append(el('h3', '', WHERE_NAMES[where]!));
      const dl = document.createElement('dl');
      for (const p of items) {
        const def = itemOf(content, p.item);
        const dt = el('dt', '', def.name);
        if (p.qty > 1) dt.append(el('span', 'qty', `×${p.qty}`));
        if (p.left) dt.append(el('span', 'qty', p.left > 0.6 ? 'opened' : p.left > 0.3 ? 'half left' : 'a little left'));
        if (p.fill) {
          const cap = def.vessel!.litres;
          const f = p.fill.litres / cap;
          const word = f <= 0 ? 'empty' : f < 0.35 ? 'a little water' : f < 0.75 ? 'half full' : 'full';
          dt.append(el('span', 'qty', showNumbers() ? `${p.fill.litres.toFixed(1)} of ${cap} l` : word));
        }
        const dd = el('dd', '', resolve(def.description, run.hold));
        const div = document.createElement('div');
        div.append(dt, dd);
        dl.append(div);
      }
      drawerBody.append(dl);
    }
    drawerBody.append(el('p', 'quiet', '[Weight, condition and contamination are shown once the pack system arrives.]'));
  }

  if (name === 'body') {
    drawerTitle.textContent = 'Body';
    if (!run) return;
    const status = dawnStatus(run, content);
    drawerBody.append(el('p', status.length ? '' : 'quiet', status.length ? status.join(' ') : 'Nothing that he has not grown used to.'));

    if (run.body.wounds.length) {
      drawerBody.append(el('h3', '', 'Wounds'));
      const dl = document.createElement('dl');
      for (const w of run.body.wounds) {
        const div = document.createElement('div');
        const where = LOCATION[w.location];
        div.append(
          el('dt', '', where[0]!.toUpperCase() + where.slice(1)),
          el('dd', '', w.note ?? `A ${w.severity} wound, ${w.state}${w.dressed ? ', dressed' : ''}.`),
        );
        dl.append(div);
      }
      drawerBody.append(dl);
    }

    if (showNumbers()) {
      const b = run.body;
      drawerBody.append(el('h3', '', 'In numbers'));
      const dl = document.createElement('dl');
      const row = (k: string, v: string) => {
        const div = document.createElement('div');
        div.append(el('dt', '', k), el('dd', '', v));
        dl.append(div);
      };
      for (const n of NEEDS) row(n[0]!.toUpperCase() + n.slice(1), `${Math.round(b[n])} of 100, ${band(b[n])}`);
      row('Wet', b.wet ? 'yes' : 'no');
      row('Today', `${Math.round(run.today.kcal)} kcal eaten, ${run.today.litres.toFixed(1)} l drunk, ${run.today.walked} h walked`);
      row('Weather', `${run.weather.kind.replace('_', ' ')}, ${run.weather.tempC}°C, wind ${run.weather.wind} of 3, snow lying ${run.weather.snow} of 3`);
      row('Illness', b.illnesses.map((i) => `${i.kind.replace('_', ' ')} (${i.severity})`).join(', ') || 'none');
      drawerBody.append(dl);
    }

    const label = document.createElement('label');
    label.className = 'toggle';
    label.htmlFor = 'show-numbers';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = 'show-numbers';
    box.checked = showNumbers();
    box.addEventListener('change', () => {
      setShowNumbers(box.checked);
      openDrawer('body');
    });
    label.append(box, ' Show numbers');
    drawerBody.append(label);
  }

  if (name === 'journal') {
    drawerTitle.textContent = 'Journal';
    if (!run || !run.journal.length) drawerBody.append(el('p', 'quiet', '[He writes in the journal from Stage 5.]'));
    else
      for (const e of run.journal) {
        drawerBody.append(el('h3', '', shortDate(e.day)));
        for (const l of e.lines) {
          const p = el('p', '', l.text);
          if (l.struckOn) p.style.textDecoration = 'line-through';
          drawerBody.append(p);
        }
      }
  }

  if (name === 'map') {
    drawerTitle.textContent = 'Map';
    if (!run) return;
    drawerBody.append(el('p', 'quiet', 'Blank paper, and the places he has walked, in pencil.'));
    const ol = document.createElement('ol');
    ol.className = 'places';
    const walked = Object.values(run.nodes)
      .filter((n) => n.known === 'visited')
      .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    for (const n of walked) {
      const region = content.regions.get(n.region)?.name ?? `region ${n.region}`;
      const li = el('li', n.id === run.node ? 'here' : '', `${kindName(templateOf(content, n.template).kind)}, ${region}`);
      ol.append(li);
    }
    drawerBody.append(ol);
  }

  if (name === 'save') drawSave();
}

function drawSave() {
  drawerTitle.textContent = 'Save';
  const msg = el('p', 'msg', '');
  msg.setAttribute('role', 'status');

  if (run) {
    drawerBody.append(
      el('p', '', 'The walk saves itself in this browser at every dawn. To keep it elsewhere, copy this save string. It holds the walk as it stood this morning.'),
    );
    const out = document.createElement('textarea');
    out.id = 'save-out';
    out.readOnly = true;
    out.value = exportSave(lastDawn ?? run);
    const copy = el('button', 'act', 'Copy save string') as HTMLButtonElement;
    copy.type = 'button';
    copy.addEventListener('click', () => {
      navigator.clipboard
        .writeText(out.value)
        .then(() => (msg.textContent = 'Copied.'))
        .catch(() => {
          out.select();
          msg.textContent = 'Selected. Copy it with your keyboard or the menu.';
        });
    });
    const row = document.createElement('div');
    row.className = 'row';
    row.append(copy);
    drawerBody.append(out, row);
  }

  drawerBody.append(el('h3', '', 'Load a save string'));
  const input = document.createElement('textarea');
  input.id = 'save-in';
  input.placeholder = 'ZR1:…';
  const load = el('button', 'act', 'Load this walk') as HTMLButtonElement;
  load.type = 'button';
  load.addEventListener('click', () => {
    try {
      const state = importSave(input.value);
      closeDrawer();
      saveRun(store, state);
      begin(state, false);
    } catch (e) {
      msg.textContent = (e as Error).message;
    }
  });
  const row2 = document.createElement('div');
  row2.className = 'row';
  row2.append(load);
  drawerBody.append(input, row2);

  if (run) {
    drawerBody.append(el('h3', '', 'Give up this walk'));
    const abandon = el('button', 'act', 'Abandon the walk') as HTMLButtonElement;
    abandon.type = 'button';
    let armed = false;
    abandon.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        abandon.textContent = 'Abandon it. This cannot be undone';
        return;
      }
      clearRun(store);
      closeDrawer();
      titleScreen();
    });
    const row3 = document.createElement('div');
    row3.className = 'row';
    row3.append(abandon);
    drawerBody.append(row3);
  }
  drawerBody.append(msg);
}

function closeDrawer() {
  drawer.hidden = true;
  openName = undefined;
  drawerNav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
}

drawerNav.addEventListener('click', (e) => {
  const name = (e.target as HTMLElement).closest('button')?.dataset.drawer as DrawerName | undefined;
  if (!name) return;
  if (openName === name) closeDrawer();
  else openDrawer(name);
});
$('drawer-close').addEventListener('click', closeDrawer);

// Keep the drawer clear of the bar, however many lines the bar wraps to.
const bar = document.querySelector('.bar') as HTMLElement;
new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight}px`)).observe(bar);

// ---------------------------------------------------------------- keys

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !drawer.hidden) return closeDrawer();
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!/^[1-9]$/.test(e.key)) return;
  const buttons = list.querySelectorAll('button');
  const b = buttons[Number(e.key) - 1];
  if (b) {
    e.preventDefault();
    b.click();
  }
});

// ---------------------------------------------------------------- boot

type Snapshot = { run?: RunState; lines: Line[]; lastDawn?: RunState };
declare global {
  interface Window {
    claude?: { hot?: { snapshot?: (fn: () => unknown) => void; ready?: (fn: (data: unknown) => void) => void; data?: unknown } };
  }
}

function start(data: unknown) {
  const snap = data as Partial<Snapshot> | undefined;
  if (snap?.run && !snap.run.ended) {
    run = snap.run;
    lines = (snap.lines ?? []).map((l) => ({ ...l, fresh: false }));
    lastDawn = snap.lastDawn;
    uiChoices = undefined;
    render();
  } else titleScreen();
}

window.claude?.hot?.snapshot?.(() => ({ run, lines, lastDawn }) satisfies Snapshot);
if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start(window.claude?.hot?.data ?? {});
