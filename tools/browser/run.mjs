import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from '../serve.mjs';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'role-model-browser-'));
const server = createServer({ dataDir });
let browser;
const contexts = [];

async function jsonRequest(base, url, method = 'GET', body) {
    const response = await fetch(base + url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    assert.equal(response.ok, true, data.error || 'HTTP ' + response.status);
    return data;
}

try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const pollId = 'eight-device-check';
    const pollUrl = '/api/polls/' + pollId;

    await jsonRequest(base, pollUrl + '/ensure', 'POST');
    await jsonRequest(base, pollUrl, 'PATCH', {
        title: 'Favourite role model',
        subtitle: 'Tap one',
        options: [
            { id: 'one', text: 'Candidate One', votes: 0 },
            { id: 'two', text: 'Candidate Two', votes: 0 }
        ],
        classes: Object.fromEntries(
            ['3A', '3B', '4A', '4B', '5A', '5B'].map((key) => [key, { roster: 20, votes: 0 }])
        ),
        active: false
    });

    browser = await chromium.launch({
        executablePath: '/usr/bin/chromium',
        args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    async function openPage(url) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        contexts.push(context);
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));
        page.on('console', (msg) => {
            if (msg.type() === 'error' &&
                !/favicon|Failed to load resource: net::ERR_FAILED/i.test(msg.text())) {
                pageErrors.push(msg.text());
            }
        });
        await page.goto(base + url, { waitUntil: 'load' });
        page.__pageErrors = pageErrors;
        return page;
    }

    const dashboard = await openPage('/dashboard.html?poll=' + pollId);
    await dashboard.waitForSelector('text=Master controls are ready', { timeout: 10000 });

    const kiosks = await Promise.all(
        ['3A', '3B', '4A', '4B', '5A', '5B'].map((classKey) =>
            openPage('/kiosk.html?poll=' + pollId + '&class=' + classKey)
        )
    );
    const projector = await openPage('/reveal.html?poll=' + pollId);
    await projector.waitForSelector('text=0 votes counted', { timeout: 10000 });
    for (const kiosk of kiosks) {
        await kiosk.waitForSelector('text=Voting is closed', { timeout: 10000 });
        assert.match(await kiosk.locator('#hd-class').innerText(), /^Class /);
    }

    console.log('\nEight-device local-network test\n');

    await dashboard.click('#btn-gate');
    await Promise.all(kiosks.map((kiosk) => kiosk.waitForSelector('[data-opt="0"]', { timeout: 10000 })));
    console.log('  ok   master opens voting and all six kiosks update live');

    const offlineRoute = '**/api/polls/' + pollId + '/votes';
    const rejectVote = (route) => route.request().method() === 'POST'
        ? route.abort()
        : route.continue();
    await kiosks[5].route(offlineRoute, rejectVote);
    await Promise.all(kiosks.map((kiosk) => kiosk.click('[data-opt="0"]')));
    await Promise.all(kiosks.slice(0, 5).map((kiosk) =>
        kiosk.waitForSelector('text=Vote recorded', { timeout: 10000 })
    ));
    await kiosks[5].waitForSelector('text=Vote held on this laptop', { timeout: 10000 });
    await kiosks[5].unroute(offlineRoute, rejectVote);
    await kiosks[5].waitForFunction(() => document.getElementById('held-pill').hidden, { timeout: 10000 });
    console.log('  ok   all six kiosks vote; a disconnected kiosk safely syncs after reconnecting');

    await Promise.all(
        Array.from({ length: 74 }, (_, i) =>
            jsonRequest(base, pollUrl + '/votes', 'POST', {
                voteId: 'extra-vote-' + String(i).padStart(4, '0'),
                optionIndex: i % 2,
                optionId: i % 2 === 0 ? 'one' : 'two',
                classKey: ['3A', '3B', '4A', '4B', '5A', '5B'][i % 6]
            })
        )
    );

    await dashboard.waitForFunction(
        () => document.querySelector('#view')?.innerText.includes('80'),
        { timeout: 10000 }
    );
    await projector.waitForSelector('text=80 votes counted', { timeout: 10000 });
    console.log('  ok   80 saved votes sync to the master dashboard and projector');

    await dashboard.click('#btn-gate');
    await dashboard.waitForSelector('text=Close voting?', { timeout: 5000 });
    await dashboard.click('[data-m="yes"]');
    await Promise.all(kiosks.map((kiosk) => kiosk.waitForSelector('text=Voting is closed', { timeout: 10000 })));
    await projector.waitForSelector('text=Voting is closed', { timeout: 10000 });
    console.log('  ok   master closes voting and all seven other screens update');

    await dashboard.click('[data-tab="classes"]');
    await dashboard.click('[data-act="seal"][data-key="3A"]');
    await dashboard.click('[data-m="yes"]');
    await kiosks[0].waitForSelector('text=has finished', { timeout: 10000 });
    console.log('  ok   sealing a class updates its assigned kiosk');

    await projector.click('#begin');
    await projector.waitForSelector('text=Candidate One', { timeout: 10000 });
    await projector.waitForSelector('text=43 votes', { timeout: 10000 });
    console.log('  ok   projector reveal reads the saved final result');

    const errors = contexts.flatMap((context) => context.pages().flatMap((page) => page.__pageErrors || []));
    assert.deepEqual(errors, [], 'browser errors: ' + errors.join('\n'));
    console.log('  ok   all eight browser pages run without JavaScript errors\n');
} finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dataDir, { recursive: true, force: true });
}
