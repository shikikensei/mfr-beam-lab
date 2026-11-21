// Turns dist/index.html into dist/preview.html: the same page without the outer
// <!doctype>/<html>/<head>/<body> tags, which the private preview host adds itself.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '';
if (!body.trim()) throw new Error('dist/index.html has no body content');
const keep = head
  .replace(/<meta[^>]*charset[^>]*>/gi, '')
  .replace(/<meta[^>]*name="viewport"[^>]*>/gi, '')
  .trim();
writeFileSync('dist/preview.html', `${keep}\n${body.trim()}\n`);
console.log(`dist/preview.html ${(Buffer.byteLength(keep + body) / 1024).toFixed(1)} kB`);
