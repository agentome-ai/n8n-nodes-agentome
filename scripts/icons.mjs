// tsc copies only the code: the icons and the codex files go next to the nodes that name them.
import { cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

for (const node of readdirSync('nodes')) {
  for (const file of readdirSync(join('nodes', node))) {
    if (/\.(svg|json)$/.test(file)) cpSync(join('nodes', node, file), join('dist/nodes', node, file));
  }
}
