import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DfsEnvelope } from '../src/index.js';

export { fixtureTransport } from '../src/index.js';

export const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function loadFixture(name: string): DfsEnvelope {
    return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8')) as DfsEnvelope;
}
