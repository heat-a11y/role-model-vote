import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { buildSite, site } from './site.mjs';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const POLL = process.env.POLL || 'role-model-2026';

function serve() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const u = new URL(req.url, 'http://x');
            const f = path.join(site, u.pathname === '/' ? '/index.html' : u.pathname);
            if (!f.startsWith(site) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
                res.writeHead(404);
                return res.end('nope');
            }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
            fs.createReadStream(f).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

let pass = 0;
let fail = 0;
const notes = [];
function ok(m) { pass += 1; console.log('  ok   ' + m); }
function bad(m, extra) { fail += 1; console.log('  FAIL ' + m + (extra ? '\n       ' + extra : '')); }
function note(m) { notes.push(m); console.log('  ..   ' + m); }

async function main() {
    buildSite({ live: true });
    const { server, port } = await serve();
    const base = 'http://127.0.0.1:' + port;

    const browser = await chromium.launch({
        executablePath: '/usr/bin/chromium',
        args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => {
        if (m.type() === 'error' && !/favicon/i.test(m.text())) pageErrors.push('console: ' + m.text());
    });

    console.log('\nLive pre-flight against school-voting-cad02\n');

    await page.goto(`${base}/kiosk.html?poll=${POLL}`, { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    // 1. Does the page even start, and is the config accepted?
    const view0 = await page.locator('#view').innerText();
    if (/setup required|placeholder/i.test(view0)) {
        bad('config not accepted by the app', view0.slice(0, 200));
        await finish();
        return;
    }
    ok('config accepted, page starts');

    // 2. Can we sign in anonymously? This is the make-or-break check.
    await page.waitForTimeout(3500);
    const net = await page.locator('#net-pill').innerText().catch(() => '');
    const view1 = await page.locator('#view').innerText();

    if (/Cannot connect/i.test(view1)) {
        bad('anonymous sign-in FAILED, the class laptops will not work', view1.replace(/\n+/g, ' ').slice(0, 300));
        if (/Anonymous/i.test(view1)) {
            note('the message mentions Anonymous: turn it on in Authentication > Sign-in method > Anonymous');
        }
        if (/authoris|authoriz/i.test(view1)) {
            note('add the host to Authentication > Settings > Authorised domains');
        }
        await finish();
        return;
    }
    ok('anonymous sign-in works (net pill: "' + net.trim() + '")');

    // 3. Does the ballot exist yet?
    const probe = await page.evaluate(async (pollId) => {
        const fs = await import('/vendor/firebase-firestore.js');
        const ref = fs.doc(fs.getFirestore(), 'polls', pollId);
        try {
            const snap = await fs.getDoc(ref);
            if (!snap.exists()) return { exists: false };
            const d = snap.data();
            return {
                exists: true,
                active: d.active === true,
                options: (d.options || []).map((o) => ({ id: o.id, text: o.text, votes: o.votes })),
                classes: d.classes || {},
                totalVotes: d.totalVotes || 0
            };
        } catch (e) {
            return { exists: false, error: e.code || e.message };
        }
    }, POLL);

    if (probe.error) {
        bad('cannot read the ballot', probe.error);
        note('if this says missing or insufficient permissions, check the firestore.rules were published');
        await finish();
        return;
    }

    if (!probe.exists) {
        ok('connected to Firestore and rules are readable');
        bad('the ballot "' + POLL + '" does not exist yet');
        note('on the master laptop: open dashboard.html, sign in with your teacher account, add candidates and classes. It creates the ballot automatically.');
        await finish();
        return;
    }

    ok('ballot "' + POLL + '" exists and is readable');

    // 4. Are the security rules actually protecting things?
    const attack = await page.evaluate(async (pollId) => {
        const fs = await import('/vendor/firebase-firestore.js');
        const ref = fs.doc(fs.getFirestore(), 'polls', pollId);
        const out = {};
        try {
            await fs.setDoc(ref, { hacked: true }, { merge: true });
            out.rewrite = 'ALLOWED';
        } catch (e) {
            out.rewrite = 'blocked';
            out.rewriteCode = e.code || '';
        }
        try {
            const snap = await fs.getDoc(fs.doc(fs.getFirestore(), 'polls', pollId, 'votes', 'nope'));
            out.readLedger = 'ALLOWED (' + (snap.exists() ? 'found' : 'empty') + ')';
        } catch (e) {
            out.readLedger = 'blocked (' + (e.code || e.message) + ')';
        }
        return out;
    }, POLL);

    if (attack.rewrite === 'ALLOWED') {
        bad('SECURITY: an unauthenticated kiosk can rewrite the ballot');
        note('publish firestore.rules, with ADMIN_EMAIL() set to your teacher email');
    } else {
        ok('security rules block an anonymous laptop from rewriting the ballot (' + attack.rewriteCode + ')');
    }

    if (/ALLOWED/.test(attack.readLedger)) {
        bad('SECURITY: any laptop can read every pupil vote record');
        note('that lets one class see what another voted. tighten the rules if that matters');
    } else {
        ok('signed vote records are not readable by the class laptops');
    }

    // 5. Can a kiosk cast a real vote right now?
    const classKeys = Object.keys(probe.classes);
    if (!classKeys.length) {
        bad('no classes on the ballot, so every vote will be rejected');
        note('on the master: Setup tab, add your classes with roll sizes');
    } else if (!probe.active) {
        note('voting is currently CLOSED, so a live vote test would be refused (correct behaviour)');
        note('classes on the ballot: ' + classKeys.join(', '));
        note('to run a live vote test: press Open voting on the master, then re-run this script');
    } else {
        const cls = classKeys[0];
        const before = probe.totalVotes;
        await page.goto(`${base}/kiosk.html?poll=${POLL}&class=${encodeURIComponent(cls)}`, { waitUntil: 'load' });
        await page.waitForSelector('[data-opt="0"]', { timeout: 15000 }).catch(() => {});
        const hasButtons = (await page.locator('[data-opt]').count()) > 0;
        if (!hasButtons) {
            bad('voting is open but the kiosk shows no candidates', (await page.locator('#view').innerText()).slice(0, 200));
        } else {
            await page.click('[data-opt="0"]');
            const confirmed = await page
                .waitForSelector('text=Vote recorded', { timeout: 10000 })
                .then(() => true)
                .catch(() => false);
            if (confirmed) {
                ok('a real vote cast from ' + cls + ' was accepted and confirmed');
                const after = await page.evaluate(async (pollId) => {
                    const fs = await import('/vendor/firebase-firestore.js');
                    const snap = await fs.getDoc(fs.doc(fs.getFirestore(), 'polls', pollId));
                    return snap.data().totalVotes;
                }, POLL);
                ok('master counter moved from ' + before + ' to ' + after);
                if (after === before + 1) {
                    ok('exactly one vote was counted, no double count');
                } else {
                    bad('expected ' + (before + 1) + ' votes but the counter reads ' + after);
                }
                note('press Reset all votes on the master dashboard to clear this test vote');
            } else {
                const v = await page.locator('#view').innerText();
                bad('the tap did not confirm as recorded', v.replace(/\n+/g, ' ').slice(0, 300));
                if (/held/i.test(v)) note('it says HELD, so the write failed. check the rules are published');
            }
        }
    }

    if (pageErrors.length) {
        bad('browser reported errors', pageErrors.slice(0, 5).join('\n       '));
    } else {
        ok('no JavaScript errors on the page');
    }

    await finish();

    async function finish() {
        await browser.close();
        server.close();
        console.log('\n' + pass + ' passed, ' + fail + ' failed');
        if (notes.length) {
            console.log('\nWhat to do next:');
            for (const n of notes) console.log('  - ' + n);
        }
        console.log('');
        process.exit(fail ? 1 : 0);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});