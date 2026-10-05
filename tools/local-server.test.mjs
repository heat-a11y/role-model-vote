import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from './serve.mjs';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'role-model-vote-'));
let server;

async function startServer() {
    server = createServer({ dataDir });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return 'http://127.0.0.1:' + server.address().port;
}

async function stopServer() {
    if (!server) return;
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    server = null;
}

async function jsonRequest(base, pathname, method = 'GET', body) {
    const response = await fetch(base + pathname, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    return { response, data };
}

let pass = 0;

async function test(name, run) {
    await run();
    pass += 1;
    console.log('  ok   ' + name);
}

try {
    let base = await startServer();
    const pollUrl = '/api/polls/event-test';

    await test('serves static app pages from the master server', async () => {
        const response = await fetch(base + '/dashboard.html');
        assert.equal(response.status, 200);
        assert.match(await response.text(), /Master Results Dashboard/);
    });

    await test('creates one shared ballot without accounts', async () => {
        const { response, data } = await jsonRequest(base, pollUrl + '/ensure', 'POST');
        assert.equal(response.status, 200);
        assert.equal(data.poll.totalVotes, 0);
        assert.equal(data.poll.active, false);
    });

    await test('broadcasts the initial ballot and later changes over SSE', async () => {
        const response = await fetch(base + pollUrl + '/events');
        assert.equal(response.status, 200);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = '';
        async function until(count) {
            while ((text.match(/data: /g) || []).length < count) {
                const next = await reader.read();
                assert.equal(next.done, false, 'event stream should remain open');
                text += decoder.decode(next.value, { stream: true });
            }
            const parts = text.split('\n\n').filter((part) => part.startsWith('data: '));
            return JSON.parse(parts[count - 1].slice(6));
        }
        const initial = await until(1);
        assert.equal(initial.poll.totalVotes, 0);
        const { response: patchResponse } = await jsonRequest(base, pollUrl, 'PATCH', {
            title: 'School vote',
            options: [
                { id: 'one', text: 'Candidate One', votes: 0 },
                { id: 'two', text: 'Candidate Two', votes: 0 }
            ],
            classes: Object.fromEntries(
                ['3A', '3B', '4A', '4B', '5A', '5B'].map((key) => [key, { roster: 20, votes: 0 }])
            ),
            active: true
        });
        assert.equal(patchResponse.status, 200);
        const updated = await until(2);
        assert.equal(updated.poll.title, 'School vote');
        assert.equal(updated.poll.active, true);
        await reader.cancel();
    });

    await test('counts 80 concurrent votes exactly once and returns the same live tally', async () => {
        const outcomes = await Promise.all(
            Array.from({ length: 80 }, (_, index) =>
                jsonRequest(base, pollUrl + '/votes', 'POST', {
                    voteId: 'vote-id-' + String(index).padStart(4, '0'),
                    optionIndex: index % 2,
                    optionId: index % 2 === 0 ? 'one' : 'two',
                    classKey: ['3A', '3B', '4A', '4B', '5A', '5B'][index % 6]
                })
            )
        );
        assert.ok(outcomes.every(({ response, data }) => response.status === 200 && data.status === 'counted'));

        const [{ data: poll }, { data: votes }] = await Promise.all([
            jsonRequest(base, pollUrl),
            jsonRequest(base, pollUrl + '/votes')
        ]);
        assert.equal(poll.totalVotes, 80);
        assert.equal(votes.length, 80);
        assert.equal(poll.options.reduce((sum, option) => sum + option.votes, 0), 80);
        assert.equal(Object.values(poll.classes).reduce((sum, group) => sum + group.votes, 0), 80);
    });

    await test('is idempotent and refuses closed, invalid, or sealed-class votes', async () => {
        const vote = {
            voteId: 'vote-id-0000',
            optionIndex: 0,
            optionId: 'one',
            classKey: '3A'
        };
        const duplicate = await jsonRequest(base, pollUrl + '/votes', 'POST', vote);
        assert.equal(duplicate.data.status, 'duplicate');
        const badClass = await jsonRequest(base, pollUrl + '/votes', 'POST', {
            ...vote,
            voteId: 'vote-bad-class-001',
            classKey: '9Z'
        });
        assert.equal(badClass.data.status, 'bad-class');

        const seal = await jsonRequest(base, pollUrl, 'PATCH', {
            sealed: { '3A': true }
        });
        assert.equal(seal.response.status, 200);
        const sealed = await jsonRequest(base, pollUrl + '/votes', 'POST', {
            ...vote,
            voteId: 'vote-sealed-0001'
        });
        assert.equal(sealed.data.status, 'class-sealed');

        const closed = await jsonRequest(base, pollUrl, 'PATCH', { active: false });
        assert.equal(closed.response.status, 200);
        const refused = await jsonRequest(base, pollUrl + '/votes', 'POST', {
            ...vote,
            voteId: 'vote-closed-0001'
        });
        assert.equal(refused.data.status, 'closed');
        const badVote = await jsonRequest(base, pollUrl + '/votes', 'POST', {
            voteId: 'bad',
            optionIndex: 0,
            classKey: '3B'
        });
        assert.equal(badVote.data.status, 'bad-vote');
    });

    await test('removing candidates or classes keeps saved counters and audit records aligned', async () => {
        const editUrl = '/api/polls/edit-test';
        await jsonRequest(base, editUrl + '/ensure', 'POST');
        await jsonRequest(base, editUrl, 'PATCH', {
            options: [
                { id: 'one', text: 'Candidate One', votes: 0 },
                { id: 'two', text: 'Candidate Two', votes: 0 }
            ],
            classes: {
                '3A': { roster: 20, votes: 0 },
                '3B': { roster: 20, votes: 0 }
            }
        });
        await jsonRequest(base, editUrl, 'PATCH', { active: true });
        const entries = [
            ['edit-vote-0001', 0, 'one', '3A'],
            ['edit-vote-0002', 1, 'two', '3A'],
            ['edit-vote-0003', 1, 'two', '3B']
        ];
        await Promise.all(entries.map(([voteId, optionIndex, optionId, classKey]) =>
            jsonRequest(base, editUrl + '/votes', 'POST', { voteId, optionIndex, optionId, classKey })
        ));
        await jsonRequest(base, editUrl, 'PATCH', { active: false });
        await jsonRequest(base, editUrl, 'PATCH', {
            options: [{ id: 'two', text: 'Updated Candidate Two', votes: 0 }],
            classes: { '3B': { roster: 20, votes: 0 } }
        });

        const [{ data: poll }, { data: votes }] = await Promise.all([
            jsonRequest(base, editUrl),
            jsonRequest(base, editUrl + '/votes')
        ]);
        assert.equal(poll.totalVotes, 1);
        assert.equal(poll.options[0].votes, 1);
        assert.equal(poll.classes['3B'].votes, 1);
        assert.equal(votes.length, 1);
        assert.equal(votes[0].optionIndex, 0);
        assert.equal(votes[0].optionText, 'Updated Candidate Two');
    });

    await test('persists ballot and vote records across a master server restart', async () => {
        const expected = (await jsonRequest(base, pollUrl)).data.totalVotes;
        await stopServer();
        base = await startServer();
        const [{ data: poll }, { data: votes }] = await Promise.all([
            jsonRequest(base, pollUrl),
            jsonRequest(base, pollUrl + '/votes')
        ]);
        assert.equal(poll.totalVotes, expected);
        assert.equal(votes.length, expected);
    });

    await test('reset clears vote records, counters, seals, and closes the ballot', async () => {
        const reset = await jsonRequest(base, pollUrl + '/reset', 'POST');
        assert.equal(reset.response.status, 200);
        assert.equal(reset.data.poll.totalVotes, 0);
        assert.equal(reset.data.poll.active, false);
        assert.deepEqual(reset.data.poll.sealed, {});
        assert.equal((await jsonRequest(base, pollUrl + '/votes')).data.length, 0);
    });

    console.log('\n' + pass + ' passed\n');
} finally {
    await stopServer();
    await fs.rm(dataDir, { recursive: true, force: true });
}
