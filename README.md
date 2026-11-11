# Zone Rouge

A text-based survival roguelike for the browser. A British reservist walks west across Lorraine and the Low Countries in January 1984, two weeks after the exchange.

- `gold/`: the three hand-polished gold days. All generated text is checked against these.
- `content/`: the game's content as YAML, one folder per kind of record.
- `docs/data-formats.md`: how to write content records.
- `src/schema/`: the schemas for content and for the saved run state.
- `src/engine/`: the day loop and its parts. Pure functions over the run state; no page code.
- `src/main.ts`, `src/ui/`: the single-column page.
- `scripts/validate-content.ts`: the content checker.
- `scripts/smoke.ts`: plays thousands of seeded runs headless to the quay.

```
npm install
npm run dev        # play it locally
npm run check      # type-check, validate content, play 300 runs
npm run smoke      # play 2,000 runs
npm run build      # static site in dist/
npm run playtest   # one-file page in dist-single/, for a claude.ai playtest page
```

Text in [square brackets] is placeholder.
