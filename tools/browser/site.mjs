import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..', '..');
export const site = path.join(here, 'site');

export function buildSite({ live = false } = {}) {
    fs.rmSync(site, { recursive: true, force: true });
    fs.mkdirSync(path.join(site, 'js'), { recursive: true });
    fs.mkdirSync(path.join(site, 'vendor'), { recursive: true });
    fs.mkdirSync(path.join(site, 'css'), { recursive: true });

    for (const f of ['store.js', 'firebase.js', 'kiosk.js', 'dashboard.js', 'reveal.js', 'ui.js', 'confetti.js']) {
        fs.copyFileSync(path.join(root, 'js', f), path.join(site, 'js', f));
    }

    if (live) {
        fs.copyFileSync(path.join(root, 'js', 'firebase-config.js'), path.join(site, 'js', 'firebase-config.js'));
        for (const f of ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js']) {
            fs.copyFileSync(path.join(root, 'vendor', f), path.join(site, 'vendor', f));
        }
    } else {
        const cfg = fs
            .readFileSync(path.join(root, 'js', 'firebase-config.js'), 'utf8')
            .replace(/REPLACE_WITH_YOUR_API_KEY/, 'test-key')
            .replace(/REPLACE_WITH_YOUR_PROJECT\.firebaseapp\.com/, 'test.firebaseapp.com')
            .replace(/REPLACE_WITH_YOUR_PROJECT/g, 'test')
            .replace(/REPLACE_WITH_MESSAGING_SENDER_ID/, '123')
            .replace(/REPLACE_WITH_YOUR_APP_ID/, 'test-app');
        fs.writeFileSync(path.join(site, 'js', 'firebase-config.js'), cfg);

        for (const f of ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js']) {
            fs.copyFileSync(path.join(root, 'tools', 'mock', 'vendor', f), path.join(site, 'vendor', f));
        }
    }

    for (const f of ['index.html', 'kiosk.html', 'dashboard.html', 'reveal.html', 'favicon.svg']) {
        fs.copyFileSync(path.join(root, f), path.join(site, f));
    }

    fs.copyFileSync(path.join(root, 'css', 'app.css'), path.join(site, 'css', 'app.css'));

    if (!fs.existsSync(path.join(site, 'css', 'app.css'))) {
        throw new Error('css/app.css missing. Run: npm run build');
    }
}