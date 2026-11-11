# Zone Rouge — data formats

*A guide for writing content. Stage 3, November 2026.*

All game content lives in plain text files under `content/`, one folder for each kind of record. You never touch the code to add a farmhouse, a fragment or a dream. You add a record to a file, and the checker tells you whether it will work.

Run the checker with `npm run validate`, or ask Claude to run it. If you break a rule it names the file, the record and the problem in English. It catches:
- misspelt item names;
- an uncanny event whose rational shadow isn't planted anywhere;
- a tableau that says the word *card*;
- an epitaph that forgets the date.

## How a record looks

Each file is a list. A record begins with `- id:` and the fields under it are indented two spaces.

```yaml
- id: frag.war.t2.republicain_31_dec
  thread: war
  tier: 2
  medium: paper
  reliability: untrue
  text: >-
    On the kitchen table a newspaper lay under a cup.
  journal: Paper from 31 Dec says France is keeping out of it.
  believes: [belief.france_kept_out]
```

Three points of YAML are worth knowing:
- `>-` lets the prose run over several lines. Line breaks inside it become spaces, and a blank line starts a new paragraph.
- Lists go in square brackets, `[1, 2, 3]`, or one per line after a dash.
- Words such as `yes`, `no`, `true` and `false` are read as switches, not words. That is why a fragment that is wrong is marked `untrue`.

Every record may also carry:
- `notes:`, which are for us and never reach the player;
- `tags:`, a free list of labels.

## Ids

An id is the kind of record, a dot, and a name in lower case with underscores. For example: `item.pear_spirit`, `node.maison_forestiere`, `frag.himself.t2.rattle_dream`. Ids never change once the game ships, because saved games refer to them.

## The house rule: flags, not names

Story records never name one another:
- encounters;
- fragments;
- uncanny events;
- tableaux;
- dreams.

They speak through **flags**, small dotted labels such as `met.turkish_family` or `belief.bitche_relief_centre`. One record sets a flag, and another waits for it. That way you can cut or rewrite any record without breaking another.

There are two special kinds of flag:
- **`belief.…`** is something he believes. A fragment that `believes` it puts a line in the journal. A later fragment that `disproves` it strikes that line through.
- **`shadow.…`** is a rational shadow. Every uncanny event names its shadow, and some other record must `plant` it, or the checker refuses to pass.

Data records are allowed to name things directly: loot tables name items, recipes name items, and the start names its kit. The checker makes sure every name exists.

## When a record fires: `when`

Most story records carry a `when:` block. Every condition given must hold, and an empty block means the record can always fire.

| Condition | Example | Meaning |
| --- | --- | --- |
| `day` | `{ gte: 20 }` | Day 20 or later. Also `lte`, `lt`, `gt`, or a bare number for that exact day |
| `hold` / `holdBand` | `[unmoored, lost]` | His Hold, as a number or by band |
| `region` | `[1, 2]` | Regions, numbered east to west |
| `phase` | `[loot]` | Dawn, plan, move, inspect, loot, tend, night |
| `timeOfDay` | `[dusk]` | Day, dusk or night |
| `weather` | `[fog, thaw]` | |
| `daysAlone` | `{ gte: 4 }` | Days since he last spent time with anyone |
| `fever`, `radiationSick` | `true` | |
| `nodeTags` | `[ossuary]` | Tags on the place he is in |
| `flags` | `{ set: [met.turkish_family] }` | Also `unset` |
| `hasItem` | `[item.forestry_map]` | |

## What a record does: `effects`

| Effect | Example |
| --- | --- |
| `hold` | `-15` |
| `setFlags`, `clearFlags` | `[seen.own_name_tape]` |
| `addItems`, `removeItems` | `[{ item: item.candle, qty: 2 }]` |
| `needs` | `{ hunger: -20 }` (lower is better) |
| `wound` | `{ location: left_leg, severity: light, state: dirty }` |
| `illness`, `dose`, `hours`, `noise` | |
| `learnRecipes` | `[recipe.water_filter]` |
| `drawFragment` | `{ thread: world, medium: people }`: hand over a fragment by kind, not by name |
| `company` | `true`: resets days alone |

## Text that changes with Hold

Any prose field can be one passage, or a set of passages by band:

```yaml
description:
  steady: A photograph of Ruth Anne Searle and Katherine Mary Searle ...
  frayed: A photograph of Ruth and Katie at the seaside that last summer ...
  unmoored: A photograph of his wife and daughter by the sea ...
  lost: A photograph of a woman and child.
```

A band you leave out falls back to the next steadier one.

## The kinds of record

**`items/`** covers everything he can carry. Fields:
- `name` is how the narration names it ("a tin of sardines").
- `weight` is in kilograms.
- `barter` is a worth from 0 to 10.
- `bound: true` means it can never be dropped, lost, traded or stolen. Only the coins and the photograph use it.
- Sub-blocks give the item its working parts: `food`, `drink`, `vessel`, `container`, `wear`, `weapon`, `ammo`, `medical`, `fuel`, `light` and `instrument`.

**`recipes/`** covers repair and improvisation. Fields:
- `inputs` and `tools` are given by item or by tag. A tag means any cloth, any blade, and so on.
- `hours`, `difficulty` (0–5), and `handPenalty` for the bad fingers.
- `text`: one sentence for when the work is done.

**`loot/`** holds what a search can turn up. Fields:
- `draws` is the number of finds from a quick and from a thorough search.
- `contamination` is the chance an unsealed find is dusty.
- Each entry has a `weight` for how likely it is.

**`regions/`** holds the seven regions. Fields:
- their languages;
- the threads they favour;
- how strongly the uncanny runs in them;
- how often a place holds a hot spot.

**`nodes/`** holds place templates. Fields:
- `glance` is the free look on arrival.
- `inspect` is the proper look.
- `pois` are the points of interest he can choose between. Each can have:
  - a loot table;
  - risks;
  - shelter quality;
  - fixed finds, such as the forester's map.
- `nodeTags` are what uncanny events and fragments look for: `deep_forest`, `forester_house`, `ossuary`.
- A `landmark` has a fixed name and appears in every run.

**`encounters/`** holds the facts about an encounter. The scene itself is written in Ink, under `ink/`, at Stage 5. Fields:
- `languages` is what the people speak.
- `disposition` is how they feel about him.
- `onEnglish` is what they do when he asks for English:
  - `broken`: they switch to broken English;
  - `fluent`: they answer in English;
  - `pretends`: they claim not to understand;
  - `faster`: they answer in their own language, faster;
  - `none`: they have no English and say so.

**`fragments/`** hold the evidence. Fields:
- `thread`, `tier` (1–4), `medium` and `reliability` (`fact`, `rumour`, `untrue`, `uncertain`).
- `text` is what he finds.
- `journal` is the line he writes that night.
- `believes` and `disproves` handle the struck-through journal.
- Himself fragments must say which truth they `lean` to (`carry`, `false_alarm`, `mask`, or `any`). They may give a `byTruth` version for each.
- A dream that carries Himself evidence is a fragment with `medium: dream`.

**`uncanny/`** holds the strange events. Fields:
- `text`;
- `effects`;
- the `shadow`, giving its key and, for us, the mundane explanation and where it is planted.

**`tableaux/`** hold the tarot scenes. Fields:
- `card` names the card for us and is never shown.
- `fits` notes when the meaning would suit the moment.
- The checker rejects *tarot*, *arcana* or *card* in the text. It warns if the card's own name appears with a capital.

**`dreams/`** hold ordinary dreams. Fields:
- `text`;
- `residue`, a line for the next dawn.

**`epitaphs/`** hold the deaths. Each has a `cause`, and its text must include `{date}` and `{place}`.

**`start.yaml`** is the man as he opens the cabin door: date, daylight, Hold, needs, the hand, his kit and where he carries it.

## The run state

The game saves one thing: the **run state**, at each dawn. It holds:
- the seed;
- the secretly drawn truth about the bridge;
- the day and phase, hours of light left, and the weather;
- the map as he knows it;
- his body, wounds, dose and Hold;
- the pack;
- the flags, the fragments found and the journal;
- what has fired and when;
- Ink's place in any half-finished chain.

A second record, the **meta state**, survives death. It holds:
- the ledger of every fragment ever found;
- each belief about the bridge;
- earlier bodies that can turn up in a ditch.

Both are defined in `src/schema/run-state.ts`, and an imported save string is checked against them before it loads.
