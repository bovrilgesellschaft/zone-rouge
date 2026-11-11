# Zone Rouge

A text-based survival roguelike for the browser. A British reservist walks west across Lorraine and the Low Countries in January 1984, two weeks after the exchange.

- `gold/`: the three hand-polished gold days. All generated text is checked against these.
- `content/`: the game's content as YAML, one folder per kind of record.
- `docs/data-formats.md`: how to write content records.
- `src/schema/`: the schemas for content and for the saved run state.
- `scripts/validate-content.ts`: the content checker.

```
npm install
npm run check   # type-check and validate all content
```
