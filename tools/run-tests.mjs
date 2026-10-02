import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const target = path.join(here, 'mock', 'js');

fs.mkdirSync(target, { recursive: true });
for (const f of ['store.js', 'firebase.js', 'firebase-config.js']) {
    fs.copyFileSync(path.join(root, 'js', f), path.join(target, f));
}

const r = execFileSync(process.execPath, [path.join(here, 'mock', 'test.mjs')], { stdio: 'inherit' });
void r;