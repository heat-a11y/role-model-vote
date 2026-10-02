import assert from 'node:assert/strict';
import { setDoc, doc, getDoc, updateDoc, __store, __listeners } from './vendor/firebase-firestore.js';

const store = await import('./js/store.js');
const mock = await import('./vendor/firebase-firestore.js');

const POLL = 'test-poll';

function freshLocalStorage() {
    const mem = new Map();
    return {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: (k) => mem.delete(k)
    };
}
globalThis.localStorage = freshLocalStorage();

let pass = 0;
let fail = 0;
const failures = [];

async function test(name, fn) {
    __store.clear();
    __listeners.length = 0;
    globalThis.localStorage = freshLocalStorage();
    try {
        await fn();
        pass += 1;
        console.log('  ok   ' + name);
    } catch (err) {
        fail += 1;
        failures.push(name + ' :: ' + err.message);
        console.log('  FAIL ' + name + '\n       ' + err.message);
    }
}

async function seed({ active = true, classes = { '3A': { roster: 30, votes: 0 }, '3B': { roster: 28, votes: 0 } } } = {}) {
    const options = [
        { id: 'o1', text: 'Candidate One', votes: 0 },
        { id: 'o2', text: 'Candidate Two', votes: 0 },
        { id: 'o3', text: 'Candidate Three', votes: 0 }
    ];
    await setDoc(doc({}, 'polls', POLL), {
        title: 'Test ballot',
        subtitle: '',
        active,
        options,
        classes,
        totalVotes: 0
    });
    return options;
}

async function readPoll() {
    const snap = await getDoc(doc({}, 'polls', POLL));
    return snap.data();
}

const mkVote = (optionIndex, classKey, voteId) => ({
    pollId: POLL,
    optionIndex,
    optionId: null,
    classKey,
    voteId
});

console.log('\nVoting logic tests\n');

await test('six concurrent votes from two classes all count, none lost', async () => {
    await seed();
    const plan = [
        [0, '3A'], [1, '3A'], [2, '3A'],
        [0, '3B'], [1, '3B'], [0, '3A']
    ];
    const results = await Promise.all(
        plan.map(([idx, cls], i) =>
            store.castVote({ pollId: POLL, optionIndex: idx, optionId: null, classKey: cls, voteId: 'v' + i })
        )
    );
    assert.equal(results.filter((r) => r.status === 'counted').length, 6, 'all six should be counted');

    const poll = await readPoll();
    assert.equal(poll.totalVotes, 6, 'totalVotes');
    const sum = poll.options.reduce((a, o) => a + o.votes, 0);
    assert.equal(sum, 6, 'option votes should sum to the total');
    assert.equal(poll.options[0].votes, 3, 'o1 votes');
    assert.equal(poll.options[1].votes, 2, 'o2 votes');
    assert.equal(poll.options[2].votes, 1, 'o3 votes');
    assert.equal(poll.classes['3A'].votes, 4, '3A votes');
    assert.equal(poll.classes['3B'].votes, 2, '3B votes');
});

await test('CONTROL: the old read-then-write pattern does lose votes', async () => {
    await seed();
    const snapshot = (await readPoll()).options;
    await Promise.all(
        [0, 1, 2, 0, 1, 0].map(async (idx, i) => {
            const local = snapshot.map((o) => ({ ...o }));
            await new Promise((r) => setTimeout(r, 2));
            const updated = local.map((o, j) => (j === idx ? { ...o, votes: o.votes + 1 } : o));
            await setDoc(doc({}, 'polls', POLL), {
                title: 'Test ballot', subtitle: '', active: true, options: updated,
                classes: { '3A': { roster: 30, votes: 0 }, '3B': { roster: 28, votes: 0 } },
                totalVotes: 6
            });
            void i;
        })
    );
    const poll = await readPoll();
    const sum = poll.options.reduce((a, o) => a + o.votes, 0);
    assert.ok(sum < 6, 'harness must be able to lose a vote, otherwise it proves nothing');
});

await test('the same vote replayed does not count twice', async () => {
    await seed();
    const v = { pollId: POLL, optionIndex: 1, optionId: null, classKey: '3A', voteId: 'same-id' };
    const first = await store.castVote(v);
    const second = await store.castVote(v);
    assert.equal(first.status, 'counted');
    assert.equal(second.status, 'duplicate');
    const poll = await readPoll();
    assert.equal(poll.totalVotes, 1, 'total after replay');
    assert.equal(poll.options[1].votes, 1, 'option after replay');
});

await test('a vote is refused while the poll is closed', async () => {
    await seed({ active: false });
    const res = await store.castVote(mkVote(0, '3A', 'closed-1'));
    assert.equal(res.status, 'closed');
    const poll = await readPoll();
    assert.equal(poll.totalVotes, 0);
});

await test('a vote for a class not on the list is refused', async () => {
    await seed();
    const res = await store.castVote(mkVote(0, '9Z', 'bad-class-1'));
    assert.equal(res.status, 'bad-class');
    const poll = await readPoll();
    assert.equal(poll.totalVotes, 0);
});

await test('a vote for a removed candidate is refused', async () => {
    await seed();
    const res = await store.castVote({
        pollId: POLL, optionIndex: 0, optionId: 'o-deleted', classKey: '3A', voteId: 'stale-1'
    });
    assert.equal(res.status, 'stale-option');
    const poll = await readPoll();
    assert.equal(poll.totalVotes, 0);
});

await test('a vote for a candidate that no longer exists is refused', async () => {
    await seed();
    const res = await store.castVote({ pollId: POLL, optionIndex: 9, optionId: null, classKey: '3A', voteId: 'oob-1' });
    assert.ok(res.status === 'bad-option' || res.status === 'stale-option', 'got ' + res.status);
    const poll = await readPoll();
    assert.equal(poll.totalVotes, 0);
});

await test('closing voting mid-session stops the next vote', async () => {
    await seed();
    assert.equal((await store.castVote(mkVote(0, '3A', 'a'))).status, 'counted');
    await store.setVotingOpen(POLL, false);
    assert.equal((await store.castVote(mkVote(0, '3A', 'b'))).status, 'closed');
    const poll = await readPoll();
    assert.equal(poll.totalVotes, 1);
    assert.equal(poll.active, false);
});

await test('reset clears every counter and closes the vote', async () => {
    await seed();
    await Promise.all([
        store.castVote(mkVote(0, '3A', 'r1')),
        store.castVote(mkVote(2, '3B', 'r2')),
        store.castVote(mkVote(1, '3A', 'r3'))
    ]);
    await store.resetVotes(POLL);
    const poll = await readPoll();
    assert.equal(poll.totalVotes, 0);
    assert.equal(poll.options.every((o) => o.votes === 0), true);
    assert.equal(poll.classes['3A'].votes, 0);
    assert.equal(poll.classes['3B'].votes, 0);
    assert.equal(poll.active, false);
    assert.equal(poll.options[0].text, 'Candidate One', 'names must survive a reset');
});

await test('the signed records match the counters exactly', async () => {
    await seed();
    const plan = [[0, '3A'], [1, '3A'], [1, '3B'], [2, '3B'], [0, '3A']];
    for (let i = 0; i < plan.length; i += 1) {
        await store.castVote({ pollId: POLL, optionIndex: plan[i][0], optionId: null, classKey: plan[i][1], voteId: 'led' + i });
    }
    const poll = await readPoll();
    const rows = await store.readLedger(POLL);
    const t = store.tallyLedger(rows, poll.options);
    assert.equal(t.total, poll.totalVotes, 'ledger total should equal counter total');
    assert.equal(t.byOption[0], poll.options[0].votes);
    assert.equal(t.byOption[1], poll.options[1].votes);
    assert.equal(t.byOption[2], poll.options[2].votes);
    assert.equal(t.byClass['3A'], poll.classes['3A'].votes);
    assert.equal(t.byClass['3B'], poll.classes['3B'].votes);
});

await test('a failed vote is held and then syncs later', async () => {
    await seed();
    const entry = { pollId: POLL, optionIndex: 2, optionId: null, classKey: '3B', voteId: 'held-1' };
    store.enqueueVote(entry);
    assert.equal(store.outboxSize(POLL), 1, 'should be queued');

    const failing = async () => {
        const e = new Error('unavailable');
        e.code = 'unavailable';
        throw e;
    };
    const sentWhileDown = await store.flushOutbox(POLL, failing);
    assert.equal(sentWhileDown, 0, 'nothing should sync while offline');
    assert.equal(store.outboxSize(POLL), 1, 'vote must not be lost while offline');

    const sent = await store.flushOutbox(POLL, store.castVote);
    assert.equal(sent, 1, 'should sync once back online');
    assert.equal(store.outboxSize(POLL), 0, 'queue should be empty');
    const poll = await readPoll();
    assert.equal(poll.totalVotes, 1, 'held vote should now be counted');
});

await test('a held vote is not counted twice when it syncs', async () => {
    await seed();
    const entry = { pollId: POLL, optionIndex: 1, optionId: null, classKey: '3A', voteId: 'dup-held' };
    store.enqueueVote(entry);
    store.enqueueVote(entry);
    await store.flushOutbox(POLL, store.castVote);
    await store.flushOutbox(POLL, store.castVote);
    const poll = await readPoll();
    assert.equal(poll.totalVotes, 1, 'idempotent through the queue too');
    assert.equal(store.outboxSize(POLL), 0);
});

await test('class names are sanitised so they cannot break the counters', async () => {
    assert.equal(store.normaliseClassKey('3A'), '3A');
    assert.equal(store.normaliseClassKey('  Year 8 B '), 'Year-8-B');
    assert.equal(store.normaliseClassKey('a.b'), 'a-b');
    assert.equal(store.normaliseClassKey('...'), '');
    assert.equal(store.normaliseClassKey(''), '');
    assert.equal(store.normaliseClassKey('x'.repeat(60)).length, 40);
    assert.equal(store.normaliseClassKey('7B_2'), '7B_2');
});

await test('a dotted class name cannot inject another counter', async () => {
    const sneaky = store.normaliseClassKey('3A.votes');
    assert.equal(sneaky, '3A-votes', 'dots must be stripped before it reaches a field path');
    assert.ok(!sneaky.includes('.'));
});

await test('option text is escaped so a name cannot inject markup', async () => {
    assert.equal(
        store.escapeHtml('<img src=x onerror=alert(1)>'),
        '&lt;img src=x onerror=alert(1)&gt;'
    );
    assert.equal(store.escapeHtml('" onmouseover="x'), '&quot; onmouseover=&quot;x');
});

await test('a poll with junk in it is repaired rather than crashing the screen', async () => {
    await setDoc(doc({}, 'polls', POLL), {
        title: 42,
        options: [{ id: 'a', text: 'Real', votes: 'x' }, null, { text: '   ' }],
        classes: { good: { roster: 'y' }, 'bad.key': { roster: 1 } },
        totalVotes: 'nope'
    });
    const p = store.normalisePoll((await readPoll()));
    assert.equal(p.title, 'Vote for your favourite role model');
    assert.equal(p.options.length, 1, 'blank and null options dropped');
    assert.equal(p.options[0].votes, 0, 'non-numeric votes coerced');
    assert.equal(p.classes.good.roster, 0);
    assert.equal(p.classes['bad.key'], undefined, 'unsafe class key dropped');
    assert.equal(p.totalVotes, 0);
    assert.equal(p.active, false);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
if (fail) {
    console.log(failures.map((f) => ' - ' + f).join('\n'));
    process.exit(1);
}
