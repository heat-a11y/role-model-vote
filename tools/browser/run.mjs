import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { root, site, buildSite } from './site.mjs';

const MIME = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json'
};

function serve() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, 'http://x');
            const file = path.join(site, url.pathname === '/' ? 'index.html' : url.pathname);
            if (!file.startsWith(site) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404);
                return res.end('nope');
            }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
            fs.createReadStream(file).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

let pass = 0;
let fail = 0;
async function check(name, fn) {
    try {
        await fn();
        pass += 1;
        console.log('  ok   ' + name);
    } catch (err) {
        fail += 1;
        console.log('  FAIL ' + name + '\n       ' + err.message);
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

async function main() {
    buildSite();
    const { server, port } = await serve();
    const base = 'http://127.0.0.1:' + port;

    const browser = await chromium.launch({
        executablePath: '/usr/bin/chromium',
        args: ['--no-sandbox', '--disable-dev-shm-usage']
    });


    async function seedPoll(page, pollId, data) {
        await page.evaluate(
            async ([id, payload]) => {
                const t = window.__testApi;
                await t.setDoc(t.doc({}, 'polls', id), JSON.parse(JSON.stringify(payload)));
            },
            [pollId, data]
        );
    }

    async function seedVote(page, pollId, voteId, data) {
        await page.evaluate(
            async ([id, vid, payload]) => {
                const t = window.__testApi;
                await t.setDoc(t.doc({}, 'polls', id, 'votes', vid), JSON.parse(JSON.stringify(payload)));
            },
            [pollId, voteId, data]
        );
    }

    const errors = [];

    async function newPage(url) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(url + ' :: ' + e.message));
        page.on('console', (m) => {
            if (m.type() === 'error') errors.push(url + ' console :: ' + m.text());
        });
        await page.goto(base + url, { waitUntil: 'load' });
        await page
            .waitForFunction(
                () => {
                    const v = document.getElementById('view');
                    if (!v) return false;
                    const t = v.innerText.trim();
                    return t.length > 0 && !/Connecting/i.test(t);
                },
                { timeout: 15000 }
            )
            .catch(() => {});
        return { ctx, page };
    }

    console.log('\nBrowser tests\n');

    await check('kiosk boots and shows the candidate buttons', async () => {
        const { ctx, page } = await newPage('/kiosk.html?poll=t1&class=3A');
        await seedPoll(page, 't1', {
            title: 'Favourite role model',
            subtitle: 'Tap one',
            active: true,
            options: [
                { id: 'o1', text: 'Mr Ali', votes: 0 },
                { id: 'o2', text: 'Ms Chen', votes: 0 },
                { id: 'o3', text: 'Coach Davies', votes: 0 }
            ],
            classes: { '3A': { roster: 30, votes: 0 }, '3B': { roster: 28, votes: 0 } },
            totalVotes: 0
        });
        await page.waitForSelector('[data-opt="0"]', { timeout: 8000 });
        const n = await page.locator('[data-opt]').count();
        assert(n === 3, 'expected 3 option buttons, saw ' + n);
        const text = await page.locator('#view h2').first().innerText();
        assert(/Favourite role model/.test(text), 'title missing: ' + text);
        await ctx.close();
    });

    await check('tapping a candidate records a vote and confirms it', async () => {
        const { ctx, page } = await newPage('/kiosk.html?poll=t2&class=3A');
        await seedPoll(page, 't2', {
            title: 'Favourite role model',
            subtitle: '',
            active: true,
            options: [
                { id: 'o1', text: 'Mr Ali', votes: 0 },
                { id: 'o2', text: 'Ms Chen', votes: 0 }
            ],
            classes: { '3A': { roster: 30, votes: 0 } },
            totalVotes: 0
        });
        await page.waitForSelector('[data-opt="1"]', { timeout: 8000 });
        await page.click('[data-opt="1"]');
        await page.waitForSelector('text=Vote recorded', { timeout: 8000 });
        const stored = await page.evaluate(() => window.__testApi.__store.get('polls/t2'));
        assert(stored.totalVotes === 1, 'totalVotes should be 1, was ' + stored.totalVotes);
        assert(stored.options[1].votes === 1, 'option 2 should have 1');
        assert(stored.options[0].votes === 0, 'option 1 should have 0');
        assert(stored.classes['3A'].votes === 1, 'class 3A should have 1');
        const ledger = await page.evaluate(() =>
            [...window.__testApi.__store.keys()].filter((k) => k.startsWith('polls/t2/votes/'))
        );
        assert(ledger.length === 1, 'expected one signed record, saw ' + ledger.length);
        await ctx.close();
    });

    await check('kiosk refuses to vote when the master has closed voting', async () => {
        const { ctx, page } = await newPage('/kiosk.html?poll=t3&class=3A');
        await seedPoll(page, 't3', {
            title: 'Favourite role model',
            subtitle: '',
            active: false,
            options: [{ id: 'o1', text: 'Mr Ali', votes: 0 }],
            classes: { '3A': { roster: 30, votes: 0 } },
            totalVotes: 0
        });
        await page.waitForSelector('text=Voting is closed', { timeout: 8000 });
        const n = await page.locator('[data-opt]').count();
        assert(n === 0, 'no vote buttons should be shown when closed');
        await ctx.close();
    });

    await check('a sealed class laptop locks itself and refuses to vote', async () => {
        const { ctx, page } = await newPage('/kiosk.html?poll=t5&class=3A');
        await seedPoll(page, 't5', {
            title: 'Favourite role model',
            subtitle: '',
            active: true,
            options: [{ id: 'o1', text: 'Mr Ali', votes: 3 }],
            classes: { '3A': { roster: 30, votes: 3 } },
            sealed: {},
            totalVotes: 3
        });
        await page.waitForSelector('[data-opt]', { timeout: 8000 });
        const before = await page.evaluate(
            () => window.__testApi.__store.get('polls/t5').totalVotes
        );

        await seedPoll(page, 't5', {
            title: 'Favourite role model',
            subtitle: '',
            active: true,
            options: [{ id: 'o1', text: 'Mr Ali', votes: 3 }],
            classes: { '3A': { roster: 30, votes: 3 } },
            sealed: { '3A': true },
            totalVotes: 3
        });

        await page.waitForSelector('text=has finished', { timeout: 8000 });
        const locked = await page.evaluate(() => document.querySelector('#view').innerText);
        assert(
            /Class 3A has finished/.test(locked),
            'kiosk should tell the pupil the class has finished, saw: ' + locked.replace(/\n/g, ' ').slice(0, 80)
        );
        const n = await page.locator('[data-opt]').count();
        assert(n === 0, 'no vote buttons should be offered once sealed');

        await page.mouse.click(400, 400);
        await page.waitForTimeout(500);
        const after = await page.evaluate(
            () => window.__testApi.__store.get('polls/t5').totalVotes
        );
        assert(after === before, 'clicking must not add a vote after sealing: ' + before + ' -> ' + after);
        await ctx.close();
    });

    await check('dashboard shows live results, turnout and the over-roll warning', async () => {
        const { ctx, page } = await newPage('/dashboard.html?poll=t4');
        await seedPoll(page, 't4', {
            title: 'Favourite role model',
            subtitle: '',
            active: true,
            options: [
                { id: 'o1', text: 'Mr Ali', votes: 12 },
                { id: 'o2', text: 'Ms Chen', votes: 7 },
                { id: 'o3', text: 'Coach Davies', votes: 2 }
            ],
            classes: {
                '3A': { roster: 30, votes: 21 },
                '3B': { roster: 5, votes: 0 }
            },
            totalVotes: 21
        });
        await page.waitForSelector('text=Mr Ali', { timeout: 8000 });
        const body = await page.locator('#view').innerText();
        assert(/21/.test(body), 'total should show 21');
        assert(/1\/2/.test(body), 'classes-voting tile should show 1/2');
        assert(/over roll/i.test(body), '3A should be flagged as over roll');
        assert(/leading/i.test(body), 'a leader should be named');
        await ctx.close();
    });

    await check('dashboard refuses to open voting without a master sign-in', async () => {
        const { ctx, page } = await newPage('/dashboard.html?poll=t5');
        await seedPoll(page, 't5', {
            title: 'Favourite role model',
            subtitle: '',
            active: false,
            options: [
                { id: 'o1', text: 'Real Name', votes: 0 },
                { id: 'o2', text: 'Other Name', votes: 0 }
            ],
            classes: { '3A': { roster: 30, votes: 0 } },
            totalVotes: 0
        });
        await page.waitForSelector('text=Master sign-in', { timeout: 8000 });
        const disabled = await page.locator('#btn-gate').isDisabled();
        assert(disabled, 'the open-voting button should be disabled for a guest');
        await ctx.close();
    });

    await check('dashboard verification flags a mismatch between counters and records', async () => {
        const { ctx, page } = await newPage('/dashboard.html?poll=t6');
        await seedPoll(page, 't6', {
            title: 'Favourite role model',
            subtitle: '',
            active: false,
            options: [
                { id: 'o1', text: 'Mr Ali', votes: 9 },
                { id: 'o2', text: 'Ms Chen', votes: 4 }
            ],
            classes: { '3A': { roster: 30, votes: 13 } },
            totalVotes: 13
        });
        await seedVote(page, 't6', 'v1', {
            optionIndex: 0,
            optionId: 'o1',
            optionText: 'Mr Ali',
            classKey: '3A',
            at: { __ts: 1 }
        });
        await page.click('[data-tab="audit"]');
        await page.waitForSelector('text=Verification', { timeout: 8000 });
        await page.waitForSelector('text=disagree', { timeout: 8000 });
        await ctx.close();
    });

    await check('landing page loads and links to both screens', async () => {
        const { ctx, page } = await newPage('/');
        const links = await page.locator('a[href]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
        assert(links.includes('dashboard.html'), 'no dashboard link');
        assert(links.includes('kiosk.html'), 'no kiosk link');
        await ctx.close();
    });

    await check('no uncaught errors on any page', async () => {
        const real = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
        assert(real.length === 0, 'console/page errors:\n' + real.join('\n'));
    });

    await browser.close();
    server.close();

    console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
    if (fail) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});