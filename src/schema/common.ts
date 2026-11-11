/**
 * Shared building blocks for every content record and for the run state.
 *
 * House rule: narrative records (encounters, fragments, uncanny events,
 * tableaux, dreams) never name each other. They talk through flags.
 * Data records (loot tables, recipes, starting kit) may name items and
 * loot tables by id, and the validator checks those names exist.
 */
import { z } from 'zod';

// ---------------------------------------------------------------- ids

/** A record id: `<type>.<name>`, lower case, e.g. `item.l1a1_rifle`. */
export const idFor = (prefix: string) =>
  z
    .string()
    .regex(
      new RegExp(`^${prefix}\\.[a-z0-9_]+(\\.[a-z0-9_]+)*$`),
      `id must look like ${prefix}.some_name (lower case, digits, underscores)`,
    );

export const ItemRef = idFor('item');
export const LootRef = idFor('loot');
export const RecipeRef = idFor('recipe');

/** Free-form flag, e.g. `met.turkish_family`, `belief.bitche_relief_centre`. */
export const FlagName = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/, 'flags are lower case, dotted: met.turkish_family');

/** A rational shadow, planted somewhere so an uncanny event has its mundane reading. */
export const ShadowKey = z
  .string()
  .regex(/^shadow\.[a-z0-9_]+$/, 'shadow keys look like shadow.light_on_hill');

/** A belief he can hold, written in the journal and later struck through. */
export const BeliefKey = z
  .string()
  .regex(/^belief\.[a-z0-9_]+$/, 'belief keys look like belief.bitche_relief_centre');

// ---------------------------------------------------------------- enums

export const RegionNo = z.number().int().min(1).max(7);

export const Phase = z.enum(['dawn', 'plan', 'move', 'inspect', 'loot', 'tend', 'night']);
export const EncounterPhase = z.enum(['move', 'inspect', 'loot', 'night']);

/** Hold bands with prose. Gone (0) is an ending, not a band with text. */
export const HoldBand = z.enum(['steady', 'frayed', 'unmoored', 'lost']);
export const NeedBand = z.enum(['fine', 'wanting', 'suffering', 'failing', 'dying']);

export const Thread = z.enum(['war', 'exchange', 'world', 'himself']);
export const Truth = z.enum(['carry', 'false_alarm', 'mask']);
/** Not 'false': YAML would read that as a yes/no. */
export const Reliability = z.enum(['fact', 'rumour', 'untrue', 'uncertain']);
export const Medium = z.enum(['paper', 'broadcast', 'people', 'place', 'dream']);

export const TimeOfDay = z.enum(['day', 'dusk', 'night']);
export const Terrain = z.enum(['road', 'field', 'forest', 'rubble']);
export const Weather = z.enum([
  'clear', 'overcast', 'fog', 'snow', 'sleet', 'rain', 'black_rain', 'ice_storm', 'thaw',
]);

/** Languages heard. Never translated; only what he understands is narrated. */
export const Language = z.enum(['en', 'fr', 'de', 'lb', 'nl', 'vls', 'tr', 'pl', 'it', 'ru', 'unknown']);

export const WoundLocation = z.enum([
  'head', 'chest', 'belly', 'back', 'left_arm', 'right_arm', 'left_hand', 'right_hand',
  'left_leg', 'right_leg', 'left_foot', 'right_foot',
]);
export const WoundSeverity = z.enum(['light', 'serious', 'grave']);
export const WoundState = z.enum(['clean', 'dirty', 'infected', 'healing', 'scarred']);
export const Illness = z.enum(['fever', 'pneumonia', 'dysentery', 'typhus', 'radiation_sickness']);

export const AmmoKind = z.enum([
  '7.62x51', // his SLR; Belgian FAL
  '7.5x54', // French MAS 49/56, AA-52
  '5.56x45', // FAMAS, M16
  '9x19',
  '7.62x39', // AK-47 / AKM
  '5.45x39', // AK-74
  '12_gauge',
  '16_gauge',
  '.22lr',
]);

// ---------------------------------------------------------------- prose

/** Text that is the same at every Hold. */
const Plain = z.string().min(1);

/**
 * Text that changes with Hold. Any band left out falls back to the
 * nearest steadier band, so `lost` alone is never needed.
 */
const ByHold = z
  .object({
    steady: Plain,
    frayed: Plain.optional(),
    unmoored: Plain.optional(),
    lost: Plain.optional(),
  })
  .strict();

export const Prose = z.union([Plain, ByHold]);
export type Prose = z.infer<typeof Prose>;

/**
 * For Himself content: the text he gets if this run drew that truth.
 * Falls back to the record's main text.
 */
export const ByTruth = z
  .object({ carry: Plain.optional(), false_alarm: Plain.optional(), mask: Plain.optional() })
  .strict();

// ---------------------------------------------------------------- conditions

const Range = z
  .object({
    eq: z.number().optional(),
    gt: z.number().optional(),
    gte: z.number().optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
  })
  .strict()
  .refine((r) => Object.keys(r).length > 0, 'a range needs at least one of eq, gt, gte, lt, lte');

/** A bare number means "equals". */
export const NumOrRange = z.union([z.number(), Range]);

/**
 * When a record may fire. Every field is optional and all given fields
 * must hold. An empty `when` means "always eligible".
 */
export const Conditions = z
  .object({
    day: NumOrRange.optional(),
    hold: NumOrRange.optional(),
    holdBand: z.array(HoldBand).nonempty().optional(),
    region: z.array(RegionNo).nonempty().optional(),
    phase: z.array(Phase).nonempty().optional(),
    timeOfDay: z.array(TimeOfDay).nonempty().optional(),
    weather: z.array(Weather).nonempty().optional(),
    /** Days since he last spent time with another person. */
    daysAlone: NumOrRange.optional(),
    /** Noise from gunfire and thorough searching, decaying over days. */
    noise: NumOrRange.optional(),
    fever: z.boolean().optional(),
    radiationSick: z.boolean().optional(),
    /** Place tags on the current node: ossuary, mine, deep_forest, flooded, ... */
    nodeTags: z.array(z.string()).nonempty().optional(),
    flags: z
      .object({
        set: z.array(FlagName).nonempty().optional(),
        unset: z.array(FlagName).nonempty().optional(),
      })
      .strict()
      .optional(),
    hasItem: z.array(ItemRef).nonempty().optional(),
    /** Engine-only. Used sparingly, for late Himself content. */
    truth: z.array(Truth).nonempty().optional(),
  })
  .strict();
export type Conditions = z.infer<typeof Conditions>;

// ---------------------------------------------------------------- effects

const ItemQty = z
  .object({ item: ItemRef, qty: z.number().int().positive().default(1) })
  .strict();

/** What a record does to the run when it fires. */
export const Effects = z
  .object({
    setFlags: z.array(FlagName).nonempty().optional(),
    clearFlags: z.array(FlagName).nonempty().optional(),
    hold: z.number().int().min(-50).max(50).optional(),
    /** Daylight hours spent. */
    hours: z.number().min(0).max(12).optional(),
    noise: z.number().int().optional(),
    /** Need changes on the 0–100 scale; positive is worse. */
    needs: z
      .object({
        hunger: z.number().optional(),
        thirst: z.number().optional(),
        cold: z.number().optional(),
        fatigue: z.number().optional(),
      })
      .strict()
      .optional(),
    dose: z.number().min(0).optional(),
    addItems: z.array(ItemQty).nonempty().optional(),
    removeItems: z.array(ItemQty).nonempty().optional(),
    wound: z
      .object({ location: WoundLocation, severity: WoundSeverity, state: WoundState.default('dirty') })
      .strict()
      .optional(),
    illness: Illness.optional(),
    learnRecipes: z.array(RecipeRef).nonempty().optional(),
    /** Draw a fragment by kind rather than by name. */
    drawFragment: z
      .object({ thread: Thread.optional(), medium: Medium.optional() })
      .strict()
      .optional(),
    /** Resets the days-alone count. */
    company: z.boolean().optional(),
  })
  .strict();
export type Effects = z.infer<typeof Effects>;

// ---------------------------------------------------------------- base

/** Fields every record may carry. `notes` is for us and is never shown to the player. */
export const baseFields = {
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
};
