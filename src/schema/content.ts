/**
 * Schemas for every kind of content record. Content lives in YAML under
 * /content, one folder per kind; each file holds a list of records.
 */
import { z } from 'zod';
import {
  AmmoKind, baseFields, BeliefKey, ByTruth, Conditions, Effects, EncounterPhase, idFor,
  Illness, ItemRef, Language, LootRef, Medium, Phase, Prose, RecipeRef, RegionNo,
  Reliability, ShadowKey, Terrain, Thread, Truth, WoundLocation, WoundSeverity, WoundState,
} from './common.js';

// ================================================================ items

export const ContainerSlot = z.enum(['pockets', 'webbing', 'rucksack', 'cart']);
export const WornSlot = z.enum(['head', 'face', 'body_inner', 'body_outer', 'legs', 'feet', 'hands', 'over']);

export const Item = z
  .object({
    id: idFor('item'),
    /** As the narration names it: `a tin of sardines`. */
    name: z.string().min(1),
    /** For more than one: `tins of sardines`. Needed for anything found or carried in numbers. */
    plural: z.string().min(1).optional(),
    /** Shown when he looks at it. May change with Hold. */
    description: Prose,
    category: z.enum([
      'weapon', 'ammo', 'blade', 'tool', 'protection', 'clothing', 'container', 'cooking',
      'fuel', 'food', 'drink', 'medical', 'light', 'paper', 'instrument', 'component',
      'barter', 'personal',
    ]),
    /** Kilograms, each. */
    weight: z.number().min(0),
    stackable: z.boolean().default(false),
    /** Cannot be dropped, lost, traded or stolen. The coins and the photograph. */
    bound: z.boolean().default(false),
    /** Rough barter worth. 0 means no one will take it. */
    barter: z.number().int().min(0).max(10).default(0),
    /** Items wear and break unless this is false. */
    hasCondition: z.boolean().default(true),

    food: z
      .object({
        kcal: z.number().int().min(0),
        /** Sealed food is free of fallout. */
        sealed: z.boolean(),
        needsCooking: z.boolean().default(false),
        /** Days before it spoils once opened or found. Absent means it keeps. */
        keepsDays: z.number().int().positive().optional(),
        /** True for a tin with no label: contents drawn when found, shown when opened. */
        unknown: z.boolean().default(false),
        /** For unknown tins: what might be inside. */
        contents: z
          .array(
            z
              .object({
                key: z.string().regex(/^[a-z_]+$/),
                kcal: z.number().int().min(0),
                weight: z.number().positive().default(1),
                /** Narrated when the tin is opened. */
                text: z.string().min(1),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
    drink: z
      .object({ litres: z.number().positive(), safe: z.boolean(), alcohol: z.boolean().default(false) })
      .strict()
      .optional(),
    /** Holds water: a bottle, a jerrycan, a mess tin. What is in it is tracked in the pack. */
    vessel: z.object({ litres: z.number().positive() }).strict().optional(),
    container: z
      .object({
        slot: ContainerSlot,
        capacityKg: z.number().positive(),
        roadsOnly: z.boolean().default(false),
        noisy: z.boolean().default(false),
      })
      .strict()
      .optional(),
    wear: z
      .object({
        slot: WornSlot,
        /** 0–5. */
        warmth: z.number().int().min(0).max(5),
        waterproof: z.boolean().default(false),
        /** Reduces dust and surface contamination. */
        nbc: z.boolean().default(false),
      })
      .strict()
      .optional(),
    weapon: z
      .object({
        kind: z.enum(['rifle', 'shotgun', 'pistol', 'smg', 'melee', 'thrown']),
        ammo: AmmoKind.optional(),
        magazine: z.number().int().positive().optional(),
        /** Best range band. */
        range: z.enum(['far', 'near', 'close']),
        /** 1–5. */
        damage: z.number().int().min(1).max(5),
        loud: z.boolean().default(true),
      })
      .strict()
      .optional(),
    ammo: z.object({ kind: AmmoKind }).strict().optional(),
    medical: z
      .object({
        treats: z.array(z.enum(['wound', 'infection', 'pain', 'fever', 'dysentery', 'radiation', 'fracture'])).nonempty(),
        uses: z.number().int().positive().default(1),
      })
      .strict()
      .optional(),
    fuel: z.object({ burnHours: z.number().positive() }).strict().optional(),
    light: z.object({ hours: z.number().positive(), naked: z.boolean().default(true) }).strict().optional(),
    instrument: z
      .object({ kind: z.enum(['dosimeter', 'survey_meter', 'radio', 'map_local', 'map_atlas', 'compass', 'watch']) })
      .strict()
      .optional(),
    /** Shadows this item plants by being looked at. */
    plants: z.array(ShadowKey).optional(),
    ...baseFields,
  })
  .strict();
export type Item = z.infer<typeof Item>;

// ================================================================ recipes

const Ingredient = z
  .object({
    item: ItemRef.optional(),
    /** Any item carrying this tag, e.g. `cloth`. */
    tag: z.string().optional(),
    qty: z.number().int().positive().default(1),
    consumed: z.boolean().default(true),
  })
  .strict()
  .refine((i) => Boolean(i.item) !== Boolean(i.tag), 'give either item or tag, not both');

export const Recipe = z
  .object({
    id: idFor('recipe'),
    name: z.string().min(1),
    inputs: z.array(Ingredient).nonempty(),
    tools: z.array(Ingredient).default([]),
    hours: z.number().positive(),
    needsFire: z.boolean().default(false),
    /** 0 is certain; 5 is hard even with two good hands. */
    difficulty: z.number().int().min(0).max(5).default(1),
    /** His crooked fingers count against him. */
    handPenalty: z.boolean().default(true),
    outputs: z.array(z.object({ item: ItemRef, qty: z.number().int().positive().default(1) }).strict()).nonempty(),
    knownAtStart: z.boolean().default(false),
    /** Narrated when the work is done. */
    text: Prose,
    ...baseFields,
  })
  .strict();

// ================================================================ loot tables

export const LootTable = z
  .object({
    id: idFor('loot'),
    /** How many draws a quick and a thorough search make. */
    draws: z.object({ quick: z.number().int().min(0), thorough: z.number().int().min(0) }).strict(),
    /** Chance an unsealed find carries fallout dust. */
    contamination: z.number().min(0).max(1).default(0),
    entries: z
      .array(
        z
          .object({
            item: ItemRef,
            weight: z.number().positive(),
            qty: z.union([z.number().int().positive(), z.tuple([z.number().int().min(0), z.number().int().positive()])]).default(1),
            /** Only on a thorough search. */
            thoroughOnly: z.boolean().default(false),
            when: Conditions.optional(),
          })
          .strict(),
      )
      .nonempty(),
    ...baseFields,
  })
  .strict();

// ================================================================ regions

export const Region = z
  .object({
    id: idFor('region'),
    number: RegionNo,
    name: z.string().min(1),
    /** The name as it sits in a sentence: `the Pays de Bitche`. */
    inProse: z.string().min(1),
    nodes: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }).strict(),
    languages: z.array(Language).nonempty(),
    focus: z.array(Thread).nonempty(),
    /** Multiplies the odds of uncanny events. 1 is normal. */
    uncanny: z.number().min(0).default(1),
    /** Chance a node carries a fallout hot spot. */
    hotspots: z.number().min(0).max(1).default(0.1),
    ...baseFields,
  })
  .strict();

// ================================================================ node templates

const Shelter = z
  .object({
    /** 0 open ground, 1 a lean-to, 2 a shed, 3 a sound house. */
    quality: z.number().int().min(0).max(3),
    /** A fire here is hidden from the road. */
    fireHidden: z.boolean().default(false),
    fireAllowed: z.boolean().default(true),
  })
  .strict();

const PointOfInterest = z
  .object({
    /** Local to this template: `house`, `woodshed`. */
    key: z.string().regex(/^[a-z][a-z0-9_]*$/),
    /** As listed in the choices: `The woodshed.` */
    label: z.string().min(1),
    loot: LootRef.optional(),
    risks: z.array(z.enum(['occupant', 'bodies', 'contamination', 'trap', 'collapse', 'dogs', 'firedamp'])).default([]),
    shelter: Shelter.optional(),
    /** Text on a first search, before the finds are listed. */
    text: Prose.optional(),
    /** Fixed, one-off finds the first time it is searched (the forester's map). */
    fixed: z.array(z.object({ item: ItemRef, qty: z.number().int().positive().default(1) }).strict()).optional(),
    effects: Effects.optional(),
  })
  .strict();

export const NodeTemplate = z
  .object({
    id: idFor('node'),
    kind: z.enum([
      'cabin', 'farm', 'hamlet', 'house', 'crossroads', 'forest_track', 'colliery', 'cite',
      'fort', 'convoy', 'town_edge', 'church', 'works', 'quay', 'landmark',
    ]),
    regions: z.array(RegionNo).nonempty(),
    /** Fixed landmarks appear in every run; templates are drawn by weight. */
    landmark: z.object({ name: z.string().min(1) }).strict().optional(),
    weight: z.number().positive().default(1),
    /** The ground he crosses to reach it. */
    terrain: Terrain,
    /** Free, on arrival. */
    glance: Prose,
    /** After a proper look, before the points of interest. */
    inspect: Prose,
    pois: z.array(PointOfInterest).nonempty(),
    /** Place tags read by uncanny events and encounters. */
    nodeTags: z.array(z.string()).default([]),
    /** Shadows this place plants just by being seen. */
    plants: z.array(ShadowKey).optional(),
    ...baseFields,
  })
  .strict();

// ================================================================ encounters

export const Encounter = z
  .object({
    id: idFor('enc'),
    category: z.enum(['looters', 'holdouts', 'authority', 'soldiers', 'refugees', 'animals', 'weather', 'dead', 'other']),
    phases: z.array(EncounterPhase).nonempty(),
    weight: z.number().positive().default(1),
    when: Conditions.default({}),
    /** Ink file under /ink, and knot: `region2/turkish_pump.ink#start`. */
    ink: z.string().regex(/^[a-z0-9_/-]+\.ink#[a-z_][a-z0-9_]*$/, 'ink must be path/to/file.ink#knot'),
    once: z.boolean().default(true),
    cooldownDays: z.number().int().positive().optional(),
    /** What they speak. Never translated. */
    languages: z.array(Language).nonempty(),
    /**
     * Their answer when he asks for English.
     * broken: switches to broken English. fluent: answers in English.
     * pretends: claims not to understand. faster: answers in their own
     * language, faster. none: has no English and says so.
     */
    onEnglish: z.enum(['broken', 'fluent', 'pretends', 'faster', 'none']),
    disposition: z.enum(['friendly', 'wary', 'hostile', 'frightened', 'indifferent']),
    plants: z.array(ShadowKey).optional(),
    ...baseFields,
  })
  .strict();

// ================================================================ fragments

export const Fragment = z
  .object({
    id: idFor('frag'),
    thread: Thread,
    tier: z.number().int().min(1).max(4),
    medium: Medium,
    reliability: Reliability,
    /** Himself only: which truth it points to. `any` is deliberately neutral. */
    leans: z.union([Truth, z.literal('any')]).optional(),
    regions: z.array(RegionNo).nonempty().optional(),
    when: Conditions.default({}),
    weight: z.number().positive().default(1),
    /** What he finds, reads, hears or sees. */
    text: Prose,
    /** Himself only: replaces `text` when the run drew this truth. */
    byTruth: ByTruth.optional(),
    /** The line he writes in the journal that night. */
    journal: z.string().optional(),
    /** Beliefs this fragment gives him (journal lines tagged with them). */
    believes: z.array(BeliefKey).optional(),
    /** Beliefs this fragment overturns: their journal lines are struck through. */
    disproves: z.array(BeliefKey).optional(),
    effects: Effects.optional(),
    plants: z.array(ShadowKey).optional(),
    ...baseFields,
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.thread === 'himself' && !f.leans)
      ctx.addIssue({ code: 'custom', path: ['leans'], message: 'Himself fragments must say which truth they lean to (or any)' });
    if (f.thread !== 'himself' && (f.leans || f.byTruth))
      ctx.addIssue({ code: 'custom', path: ['leans'], message: 'only Himself fragments lean or vary by truth' });
  });

// ================================================================ the uncanny

export const Uncanny = z
  .object({
    id: idFor('uncanny'),
    phases: z.array(Phase).nonempty(),
    regions: z.array(RegionNo).nonempty().optional(),
    when: Conditions.default({}),
    weight: z.number().positive().default(1),
    once: z.boolean().default(true),
    text: Prose,
    effects: Effects.optional(),
    shadow: z
      .object({
        key: ShadowKey,
        /** For us: the mundane reading and where it is planted. */
        explanation: z.string().min(1),
      })
      .strict(),
    ...baseFields,
  })
  .strict();

// ================================================================ tableaux

export const Tableau = z
  .object({
    id: idFor('tableau'),
    /** Internal only. Never shown, logged or hinted at. */
    card: z.string().min(1),
    phases: z.array(Phase).nonempty(),
    regions: z.array(RegionNo).nonempty().optional(),
    when: Conditions.default({}),
    weight: z.number().positive().default(1),
    /** For us: where the card's meaning would suit the moment. */
    fits: z.string().optional(),
    text: Prose,
    /** Only what the scene itself would cause. */
    effects: Effects.optional(),
    plants: z.array(ShadowKey).optional(),
    ...baseFields,
  })
  .strict();

// ================================================================ dreams

/** Ordinary dreams. Dreams carrying Himself evidence are Fragments with medium: dream. */
export const Dream = z
  .object({
    id: idFor('dream'),
    when: Conditions.default({}),
    weight: z.number().positive().default(1),
    text: Prose,
    /** One line for the next dawn. */
    residue: z.string().optional(),
    effects: Effects.optional(),
    plants: z.array(ShadowKey).optional(),
    ...baseFields,
  })
  .strict();

// ================================================================ epitaphs

export const Epitaph = z
  .object({
    id: idFor('epitaph'),
    cause: z.enum(['cold', 'hunger', 'thirst', 'wound', 'infection', 'illness', 'radiation', 'violence', 'drowning', 'other']),
    when: Conditions.default({}),
    weight: z.number().positive().default(1),
    /** Must contain {date} and {place}. */
    text: z.string().min(1),
    ...baseFields,
  })
  .strict()
  .refine((e) => e.text.includes('{date}') && e.text.includes('{place}'), {
    path: ['text'],
    message: 'an epitaph names the day and the place: include {date} and {place}',
  });

// ================================================================ phrases

/**
 * Recurring prose: the dawn status, the weather, the small acts of Tend,
 * the night. Each slot holds several phrases and the engine draws one, so
 * day forty does not read like day four. A slot with nothing written
 * falls back to a [placeholder].
 */
export const PHRASE_SLOTS = {
  'weather.clear': [], 'weather.overcast': [], 'weather.fog': [], 'weather.snow': [],
  'weather.sleet': [], 'weather.rain': [], 'weather.black_rain': [], 'weather.ice_storm': [],
  'weather.thaw': [],
  'status.hunger.wanting': [], 'status.hunger.suffering': [], 'status.hunger.failing': [], 'status.hunger.dying': [],
  'status.thirst.wanting': [], 'status.thirst.suffering': [], 'status.thirst.failing': [], 'status.thirst.dying': [],
  'status.cold.wanting': [], 'status.cold.suffering': [], 'status.cold.failing': [], 'status.cold.dying': [],
  'status.fatigue.wanting': [], 'status.fatigue.suffering': [], 'status.fatigue.failing': [], 'status.fatigue.dying': [],
  'status.wet': [], 'status.fever': [], 'status.pneumonia': [],
  'status.wound.dirty': ['location'], 'status.wound.infected': ['location'], 'status.wound.grave': ['location'],
  'tend.eat': ['food'], 'tend.eat_cooked': ['food'], 'tend.drink': ['vessel'], 'tend.melt_snow': [],
  'tend.fire': [], 'tend.dress': ['location'], 'tend.clean_wound': ['location'], 'tend.spirit': ['location'],
  'night.warm': [], 'night.cold': [], 'night.freezing': [],
  'tend.photograph': ['photograph'], 'hold.memory': [], 'hold.voice': [], 'hold.wandered': [],
  'loot.took': ['items'], 'loot.nothing': [], 'loot.no_room': ['items'], 'pack.take_up': ['items'],
  'pack.left_pram': [], 'pack.feet': ['location'], 'tend.open_tin': [],
} as const satisfies Record<string, readonly string[]>;
export type PhraseSlot = keyof typeof PHRASE_SLOTS;

export const Phrase = z
  .object({
    id: idFor('phrase'),
    slot: z.enum(Object.keys(PHRASE_SLOTS) as [PhraseSlot, ...PhraseSlot[]]),
    when: Conditions.default({}),
    weight: z.number().positive().default(1),
    /** May use the slot's tokens, e.g. {food}, {location}. */
    text: Prose,
    ...baseFields,
  })
  .strict();

// ================================================================ the start

export const Start = z
  .object({
    id: z.literal('start'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    daylightHours: z.number().positive(),
    hold: z.number().int().min(1).max(100),
    /** 0 fine to 100 dying. */
    needs: z
      .object({ hunger: z.number(), thirst: z.number(), cold: z.number(), fatigue: z.number() })
      .strict(),
    wounds: z
      .array(
        z
          .object({
            location: WoundLocation,
            severity: WoundSeverity,
            state: WoundState,
            /** Shown in the Body drawer in place of the usual wording. */
            text: z.string().optional(),
            note: z.string().optional(),
          })
          .strict(),
      )
      .default([]),
    illnesses: z.array(Illness).default([]),
    kit: z
      .array(
        z
          .object({
            item: ItemRef,
            qty: z.number().int().positive().default(1),
            where: z.enum(['hands', 'worn', 'pockets', 'webbing', 'rucksack']),
            /** 0–100. */
            condition: z.number().int().min(0).max(100).default(100),
            /** For vessels: litres of clean water in it. */
            litres: z.number().min(0).optional(),
          })
          .strict(),
      )
      .nonempty(),
    recipes: z.array(RecipeRef).default([]),
    flags: z.array(z.string()).default([]),
    ...baseFields,
  })
  .strict();

// ================================================================ registry

/** Folder under /content → schema, and the id prefix records there must use. */
export const CONTENT_KINDS = {
  items: { schema: Item, prefix: 'item' },
  recipes: { schema: Recipe, prefix: 'recipe' },
  loot: { schema: LootTable, prefix: 'loot' },
  regions: { schema: Region, prefix: 'region' },
  nodes: { schema: NodeTemplate, prefix: 'node' },
  encounters: { schema: Encounter, prefix: 'enc' },
  fragments: { schema: Fragment, prefix: 'frag' },
  uncanny: { schema: Uncanny, prefix: 'uncanny' },
  tableaux: { schema: Tableau, prefix: 'tableau' },
  dreams: { schema: Dream, prefix: 'dream' },
  epitaphs: { schema: Epitaph, prefix: 'epitaph' },
  phrases: { schema: Phrase, prefix: 'phrase' },
} as const;

export type ContentKind = keyof typeof CONTENT_KINDS;
