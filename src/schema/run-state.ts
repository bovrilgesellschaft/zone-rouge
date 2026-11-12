/**
 * The run state: everything needed to resume a run from its last dawn.
 * Systems are pure functions (state, input) → state. Nothing else is saved.
 *
 * The meta state is separate and survives death: the ledger, the beliefs,
 * the remains.
 *
 * Both are zod schemas so that an imported save string can be checked
 * before it is loaded.
 */
import { z } from 'zod';
import {
  Illness, Language, Phase, RegionNo, Terrain, Thread, Truth, Weather, WoundLocation,
  WoundSeverity, WoundState,
} from './common.js';

/** Bumped when the shape changes; older saves are set aside rather than loaded. */
export const RUN_STATE_VERSION = 2 as const;
export const META_STATE_VERSION = 1 as const;

export const Difficulty = z.enum(['thaw', 'winter', 'nuclear_winter']);
export const Ending = z.enum(['crossing', 'staying', 'long_walk', 'cabin', 'death']);

/** Seeded generator state. Separate streams so a change in one system does not reshuffle the map. */
const Rng = z
  .object({
    world: z.number().int(), // map, contamination, node contents
    weather: z.number().int(), // the seeded calendar
    events: z.number().int(), // encounters, uncanny, dreams, loot draws
    combat: z.number().int(),
  })
  .strict();

// ---------------------------------------------------------------- the map

const Link = z
  .object({
    to: z.string(),
    terrain: Terrain,
    /** Base hours before snow and fatigue. Road 2, field 3, forest or rubble 4. */
    hours: z.number().positive(),
  })
  .strict();

const NodeInstance = z
  .object({
    id: z.string(),
    template: z.string(),
    region: RegionNo,
    /** Place name, if it has one: a village, a farm's name off its gatepost. */
    name: z.string().optional(),
    links: z.array(Link),
    /**
     * unknown: not on any map he has. mapped: on a map he found.
     * seen: he has looked at it from somewhere. visited: he has been there.
     */
    known: z.enum(['unknown', 'mapped', 'seen', 'visited']),
    inspected: z.boolean(),
    /** POI key → how thoroughly it has been searched. */
    searched: z.record(z.enum(['quick', 'thorough'])),
    /** Dose rate here in rad per hour outdoors. Hidden from the player. */
    doseRate: z.number().min(0),
  })
  .strict();

// ---------------------------------------------------------------- the body

const Wound = z
  .object({
    uid: z.string(),
    location: WoundLocation,
    severity: WoundSeverity,
    state: WoundState,
    dressed: z.boolean(),
    /** Day the wound was taken, or last changed state. */
    since: z.number().int(),
    /** Fixed description, for wounds with a history (the hand). */
    note: z.string().optional(),
  })
  .strict();

const Body = z
  .object({
    /** 0 is fine and 100 is dying, for each need. Bands are derived. */
    hunger: z.number().min(0).max(100),
    thirst: z.number().min(0).max(100),
    cold: z.number().min(0).max(100),
    fatigue: z.number().min(0).max(100),
    /** Running calorie deficit; drives strength and healing. */
    deficitKcal: z.number().min(0),
    wet: z.boolean(),
    wounds: z.array(Wound),
    illnesses: z.array(z.object({ kind: Illness, since: z.number().int(), severity: z.number().min(0).max(3) }).strict()),
  })
  .strict();

const Dose = z
  .object({
    /** Cumulative rad. Never shown unless he carries a working dosimeter. */
    total: z.number().min(0),
    /** Day the latent period ends and the worst of it starts, if a dose has been taken. */
    latentUntil: z.number().int().optional(),
  })
  .strict();

// ---------------------------------------------------------------- the pack

const Carried = z
  .object({
    uid: z.string(),
    item: z.string(),
    qty: z.number().int().positive(),
    where: z.enum(['hands', 'worn', 'pockets', 'webbing', 'rucksack', 'cart']),
    condition: z.number().int().min(0).max(100),
    /** Known clean, known contaminated, or he does not know. */
    contamination: z.enum(['clean', 'contaminated', 'unknown']),
    /** For unlabelled tins: what it really is, drawn when found, shown when opened. */
    secret: z.string().optional(),
    /** Food part eaten: the fraction left. Absent means whole. */
    left: z.number().gt(0).max(1).optional(),
    /** For vessels: what is in it. */
    fill: z
      .object({ litres: z.number().min(0), water: z.enum(['clean', 'contaminated', 'unknown']) })
      .strict()
      .optional(),
  })
  .strict();

// ---------------------------------------------------------------- the journal

const JournalLine = z
  .object({
    text: z.string(),
    /** A belief this line records, so a later fragment can strike it through. */
    belief: z.string().optional(),
    struckOn: z.number().int().optional(),
  })
  .strict();

const JournalEntry = z
  .object({ day: z.number().int().positive(), lines: z.array(JournalLine) })
  .strict();

// ---------------------------------------------------------------- the run

export const RunState = z
  .object({
    version: z.literal(RUN_STATE_VERSION),
    seed: z.string().min(1),
    rng: Rng,
    difficulty: Difficulty,
    /** Drawn at the start. Never shown, never confirmed. */
    truth: Truth,

    day: z.number().int().positive(),
    phase: Phase,
    /** The point of interest he has chosen to search, during Loot. */
    focus: z.string().optional(),
    /** Set when the run is over. */
    ended: z.object({ ending: Ending, day: z.number().int(), cause: z.string().optional() }).strict().optional(),
    hoursLeft: z.number(),
    weather: z
      .object({
        kind: Weather,
        tempC: z.number(),
        wind: z.number().int().min(0).max(3),
        /** Snow lying: 0 none, 1 a dusting, 2 ankle deep, 3 drifts. */
        snow: z.number().int().min(0).max(3),
      })
      .strict(),
    /** What he has had and done today. Reset at dawn. */
    today: z
      .object({
        kcal: z.number().min(0),
        litres: z.number().min(0),
        /** Hours walked. */
        walked: z.number().min(0),
        /** Hours outdoors and still. */
        idle: z.number().min(0),
        fire: z.boolean(),
        /** Spirit or antiseptic put on an infected wound today. */
        antiseptic: z.boolean(),
      })
      .strict(),

    node: z.string(),
    nodes: z.record(NodeInstance),

    body: Body,
    dose: Dose,
    hold: z.number().min(0).max(100),
    pack: z.array(Carried),

    flags: z.record(z.union([z.boolean(), z.number(), z.string()])),
    knownRecipes: z.array(z.string()),
    /** Fragments found this run, in order, with the day found. */
    fragments: z.array(z.object({ id: z.string(), day: z.number().int() }).strict()),
    journal: z.array(JournalEntry),

    /** Record id → last day it fired, for once-only and cooldown rules. */
    fired: z.record(z.number().int()),
    /** Tableaux this run, for the one-to-three rule and never two in a day. */
    tableaux: z.array(z.object({ id: z.string(), day: z.number().int() }).strict()),
    /** Saved Ink story state for encounters mid-chain. */
    ink: z.record(z.string()),

    noise: z.number().min(0),
    /** Last day he spent time with another person. Days alone are derived. */
    lastCompany: z.number().int(),
    /** Languages he has picked words of, and roughly how many. */
    words: z.record(Language, z.number().int().min(0)).optional(),
  })
  .strict();
export type RunState = z.infer<typeof RunState>;

// ---------------------------------------------------------------- across runs

export const MetaState = z
  .object({
    version: z.literal(META_STATE_VERSION),
    runs: z.number().int().min(0),
    endings: z.record(Ending, z.number().int().min(0)),
    /** Every fragment ever found: id → first run and day. Organised by thread in the ledger. */
    ledger: z.record(z.object({ thread: Thread, seed: z.string(), day: z.number().int() }).strict()),
    /** Each version of the bridge he came to believe. Never marked true or false. */
    beliefs: z.array(z.object({ seed: z.string(), believed: Truth.or(z.literal('none')), day: z.number().int() }).strict()),
    /** Earlier runs that can turn up as a body in a ditch. */
    remains: z.array(
      z
        .object({
          seed: z.string(),
          day: z.number().int(),
          region: RegionNo,
          cause: z.string(),
          ending: Ending,
          /** A few lines of his journal, to be found on the body. */
          journal: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();
export type MetaState = z.infer<typeof MetaState>;
