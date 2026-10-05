import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from '../serve.mjs';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'role-model-render-'));
const server = createServer({ dataDir });
let browser;

try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const pollId = 'render-check';
    const pollUrl = '/api/polls/' + pollId;
    await fetch(base + pollUrl + '/ensure', { method: 'POST' });
    const options = [
        ['one', 'Mr Ali', 14],
        ['two', 'Ms Chen', 9],
        ['three', 'Coach Davies', 6],
        ['four', 'Mrs Okafor', 3]
    ];
    await fetch(base + pollUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: 'Favourite role model',
            subtitle: 'Tap one',
            active: false,
            options: options.map(([id, text]) => ({ id, text, votes: 0 })),
            classes: { '3A': { roster: 30, votes: 0 }, '3B': { roster: 28, votes: 0 } }
        })
    });
    await fetch(base + pollUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true })
    });
    await Promise.all(Array.from({ length: 32 }, (_, i) => fetch(base + pollUrl + '/votes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            voteId: 'render-vote-' + String(i).padStart(3, '0'),
            optionIndex: i % 4,
            optionId: options[i % 4][0],
            classKey: i % 2 === 0 ? '3A' : '3B'
        })
    })));

    browser = await chromium.launch({
        executablePath: '/usr/bin/chromium',
        args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const errors = [];
    async function page(url) {
        const result = await browser.newPage({ viewport: { width: 1440, height: 960 } });
        result.on('pageerror', (err) => errors.push(err.message));
        result.on('console', (msg) => {
            if (msg.type() === 'error' && !/favicon/i.test(msg.text())) errors.push(msg.text());
        });
        await result.goto(base + url, { waitUntil: 'load' });
        return result;
    }

    const kiosk = await page('/kiosk.html?poll=' + pollId + '&class=3A');
    await kiosk.waitForSelector('[data-opt="0"]', { timeout: 10000 });
    const kioskInfo = await kiosk.evaluate(() => {
        const button = document.querySelector('[data-opt]');
        const style = getComputedStyle(button);
        const body = getComputedStyle(document.body);
        return {
            count: document.querySelectorAll('[data-opt]').length,
            background: body.backgroundColor,
            gradient: style.backgroundImage.includes('gradient'),
            target: button.getBoundingClientRect().toJSON(),
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            stylesheetLoaded: [...document.styleSheets].some((sheet) => {
                try { return sheet.cssRules.length > 50; } catch { return false; }
            })
        };
    });
    assert.equal(kioskInfo.count, 4);
    assert.equal(kioskInfo.background, 'rgb(2, 6, 23)');
    assert.equal(kioskInfo.gradient, true);
    assert.ok(kioskInfo.target.width > 200 && kioskInfo.target.height >= 140);
    assert.equal(kioskInfo.overflow, false);
    assert.equal(kioskInfo.stylesheetLoaded, true);
    console.log('  ok   voting screen renders four large, styled touch targets');

    const dashboard = await page('/dashboard.html?poll=' + pollId);
    await dashboard.waitForSelector('text=Mr Ali', { timeout: 10000 });
    assert.equal(await dashboard.locator('#view .stat-value').count(), 4);
    assert.equal(await dashboard.locator('#view .bar-track > div').count(), 4);
    assert.equal(await dashboard.locator('#btn-gate').isDisabled(), false);
    console.log('  ok   master dashboard renders result bars, totals, and active controls');

    const projector = await page('/reveal.html?poll=' + pollId);
    await projector.waitForSelector('text=32 votes counted', { timeout: 10000 });
    assert.match(await projector.locator('#stage').innerText(), /Favourite role model/);
    assert.deepEqual(errors, [], 'browser errors: ' + errors.join('\n'));
    console.log('  ok   projector renders the shared ballot with no browser errors\n');
} finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dataDir, { recursive: true, force: true });
}
