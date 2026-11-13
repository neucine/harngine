import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const template = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../public/index.html'),
  'utf8',
);

export function workbenchHtml(capability: string | null): string {
  const escaped = (capability ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;');
  return template.replace('__CAPABILITY__', escaped);
}
