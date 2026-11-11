// Turns the single-file build into a playtest page for a claude.ai artifact,
// which supplies its own <html>, <head> and <body>.
//   npm run build:single && node scripts/playtest-page.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist-single/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, '')
  .replace(/<meta name="viewport"[^>]*>\s*/, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
// Scripts run after the markup they look for.
const scripts = head.match(/<script[\s\S]*?<\/script>/g) ?? [];
const rest = head.replace(/<script[\s\S]*?<\/script>/g, '');
writeFileSync('dist-single/playtest.html', `${rest.trim()}\n${body.trim()}\n${scripts.join('\n')}\n`);
console.log('dist-single/playtest.html written');
