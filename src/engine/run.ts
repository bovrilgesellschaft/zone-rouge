/** Making a new run from a seed and content/start.yaml. */
import { RUN_STATE_VERSION, RunState } from '../schema/run-state.js';
import { daylight } from './calendar.js';
import { type Content, itemOf } from './content.js';
import { generateMap, revealAround } from './map.js';
import { Rng, seedStreams } from './rng.js';
import { freshDay } from './body.js';
import { DAY_ONE } from './weather.js';

const TRUTHS = ['carry', 'false_alarm', 'mask'] as const;

/** Day 1 is 16 January. He last spent time with anyone at the bridge, about 18 December. */
const LAST_COMPANY = -29;

export function newRun(seed: string, content: Content, difficulty: RunState['difficulty'] = 'winter'): RunState {
  const streams = seedStreams(seed);
  const world = new Rng(streams.world);
  const events = new Rng(streams.events);

  const truth = events.pick(TRUTHS);
  const { nodes, start } = generateMap(world, content);
  revealAround(nodes, start);
  nodes[start]!.inspected = true;

  const s = content.start;
  const pack: RunState['pack'] = s.kit.map((k, i) => {
    const def = itemOf(content, k.item);
    return {
      uid: `p${i}`,
      item: k.item,
      qty: k.qty,
      where: k.where,
      condition: def.hasCondition ? k.condition : 100,
      contamination: 'clean' as const,
      ...(def.vessel ? { fill: { litres: k.litres ?? 0, water: 'clean' as const } } : {}),
    };
  });

  const state: RunState = {
    version: RUN_STATE_VERSION,
    seed,
    rng: { world: world.state, weather: streams.weather, events: events.state, combat: streams.combat },
    difficulty,
    truth,
    day: 1,
    phase: 'dawn',
    hoursLeft: s.daylightHours ?? daylight(1),
    weather: { ...DAY_ONE },
    today: freshDay(),
    node: start,
    nodes,
    body: {
      ...s.needs,
      deficitKcal: 0,
      wet: false,
      wounds: s.wounds.map((w, i) => ({
        uid: `w${i}`,
        location: w.location,
        severity: w.severity,
        state: w.state,
        dressed: false,
        since: 0,
        ...(w.text ? { note: w.text } : {}),
      })),
      illnesses: s.illnesses.map((kind) => ({ kind, since: 0, severity: 1 })),
    },
    dose: { total: 0 },
    hold: s.hold,
    pack,
    flags: Object.fromEntries(s.flags.map((f) => [f, true])),
    knownRecipes: [...s.recipes],
    fragments: [],
    journal: [],
    fired: {},
    tableaux: [],
    ink: {},
    noise: 0,
    lastCompany: LAST_COMPANY,
  };
  return RunState.parse(state);
}
