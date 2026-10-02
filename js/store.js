import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    runTransaction,
    onSnapshot,
    collection,
    getDocs,
    query,
    serverTimestamp,
    increment
} from '../vendor/firebase-firestore.js';

import { getDb } from './firebase.js';

const OUTBOX_KEY = 'rmv.outbox.v1';
const CLASS_KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function newId() {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch (e) {
        void e;
    }
    const rnd = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    return Date.now().toString(16) + '-' + rnd() + '-' + rnd();
}

export function normaliseClassKey(raw) {
    const cleaned = String(raw == null ? '' : raw)
        .trim()
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return CLASS_KEY_RE.test(cleaned) ? cleaned : '';
}

export function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function pollRef(pollId) {
    return doc(getDb(), 'polls', pollId);
}

export function defaultPoll() {
    const mk = (n) => ({ id: 'opt_' + n, text: 'Example Role Model ' + n, votes: 0 });
    return {
        title: 'Vote for your favourite role model',
        subtitle: 'Tap the person you look up to most.',
active: false,
    options: [mk(1), mk(2), mk(3), mk(4)],
    classes: {},
    sealed: {},
    totalVotes: 0,
    createdAt: null,
    updatedAt: null
    };
}

export function normalisePoll(raw) {
    const base = defaultPoll();
    if (!raw || typeof raw !== 'object') return base;
    const options = Array.isArray(raw.options)
        ? raw.options
              .filter((o) => o && typeof o.text === 'string' && o.text.trim() !== '')
              .map((o) => ({
                  id: typeof o.id === 'string' && o.id ? o.id : 'opt_' + newId().slice(0, 8),
                  text: String(o.text).slice(0, 120),
                  votes: Number.isFinite(o.votes) ? o.votes : 0
              }))
        : base.options;
    const classes = {};
    if (raw.classes && typeof raw.classes === 'object') {
        for (const [key, val] of Object.entries(raw.classes)) {
            if (!CLASS_KEY_RE.test(key)) continue;
            classes[key] = {
                roster: Number.isFinite(val && val.roster) ? val.roster : 0,
                votes: Number.isFinite(val && val.votes) ? val.votes : 0
            };
        }
    }
    const summed = options.reduce((a, o) => a + o.votes, 0);
    const sealed = {};
    if (raw.sealed && typeof raw.sealed === 'object') {
        for (const [key, value] of Object.entries(raw.sealed)) {
            if (CLASS_KEY_RE.test(key) && value === true) sealed[key] = true;
        }
    }
    return {
        title: typeof raw.title === 'string' ? raw.title.slice(0, 200) : base.title,
        subtitle: typeof raw.subtitle === 'string' ? raw.subtitle.slice(0, 300) : base.subtitle,
        active: raw.active === true,
        options,
        classes,
        sealed,
        totalVotes: Number.isFinite(raw.totalVotes) ? raw.totalVotes : summed,
        createdAt: raw.createdAt || null,
        updatedAt: raw.updatedAt || null
    };
}

export async function ensurePoll(pollId) {
    const ref = pollRef(pollId);
    const snap = await getDoc(ref);
    if (snap.exists()) return true;
    try {
        await setDoc(ref, { ...defaultPoll(), createdAt: serverTimestamp() });
        return true;
    } catch (err) {
        if (isPermissionDenied(err)) return false;
        throw err;
    }
}

export function isPermissionDenied(err) {
    const code = (err && err.code) || '';
    return code === 'permission-denied' || code === 'firestore/permission-denied';
}

export function subscribePoll(pollId, onData, onError) {
    return onSnapshot(
        pollRef(pollId),
        (snap) => {
            if (snap.exists()) onData(normalisePoll(snap.data()));
        },
        (err) => {
            if (onError) onError(err);
        }
    );
}

export async function castVote({ pollId, optionIndex, optionId, classKey, voteId }) {
    const db = getDb();
    const ref = pollRef(pollId);
    const ledgerRef = doc(db, 'polls', pollId, 'votes', voteId);

    return runTransaction(db, async (tx) => {
        const ledgerSnap = await tx.get(ledgerRef);
        if (ledgerSnap.exists()) {
            return { status: 'duplicate' };
        }

        const pollSnap = await tx.get(ref);
        if (!pollSnap.exists()) {
            return { status: 'no-poll' };
        }
        const poll = normalisePoll(pollSnap.data());

        if (poll.active !== true) {
            return { status: 'closed' };
        }
        const opt = poll.options[optionIndex];
        if (!opt) {
            return { status: 'bad-option' };
        }
        if (optionId && opt.id !== optionId) {
            return { status: 'stale-option', options: poll.options };
        }
        if (!poll.classes[classKey]) {
            return { status: 'bad-class' };
        }
        if (poll.sealed[classKey] === true) {
            return { status: 'class-sealed' };
        }

        tx.update(ref, {
            ['options.' + optionIndex + '.votes']: increment(1),
            totalVotes: increment(1),
            ['classes.' + classKey + '.votes']: increment(1)
        });
        tx.set(ledgerRef, {
            optionIndex,
            optionId: opt.id,
            optionText: opt.text,
            classKey,
            at: serverTimestamp()
        });

        return { status: 'counted', total: poll.totalVotes + 1 };
    });
}

export async function savePoll(pollId, patch) {
    await setDoc(
        pollRef(pollId),
        { ...patch, updatedAt: serverTimestamp() },
        { merge: true }
    );
}

export async function setVotingOpen(pollId, open) {
    await updateDoc(pollRef(pollId), { active: open === true, updatedAt: serverTimestamp() });
}

export async function setClassSealed(pollId, classKey, sealed) {
    const snap = await getDoc(pollRef(pollId));
    if (!snap.exists()) throw new Error('Ballot not found');
    const current = normalisePoll(snap.data());
    const next = { ...current.sealed };
    if (sealed) {
        next[classKey] = true;
    } else {
        delete next[classKey];
    }
    await updateDoc(pollRef(pollId), { sealed: next, updatedAt: serverTimestamp() });
}

export async function resetVotes(pollId) {
    const db = getDb();
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(pollRef(pollId));
        if (!snap.exists()) return;
        const poll = normalisePoll(snap.data());
        tx.update(pollRef(pollId), {
            options: poll.options.map((o) => ({ id: o.id, text: o.text, votes: 0 })),
            totalVotes: 0,
            classes: Object.fromEntries(
                Object.entries(poll.classes).map(([k, v]) => [k, { roster: v.roster, votes: 0 }])
            ),
            active: false
        });
    });
}

export async function readLedger(pollId) {
    const db = getDb();
    const snap = await getDocs(query(collection(db, 'polls', pollId, 'votes')));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function tallyLedger(rows, options) {
    const byClass = {};
    const byOption = options.map(() => 0);
    for (const row of rows) {
        byClass[row.classKey] = (byClass[row.classKey] || 0) + 1;
        if (Number.isInteger(row.optionIndex) && row.optionIndex < byOption.length) {
            byOption[row.optionIndex] += 1;
        }
    }
    return { byClass, byOption, total: rows.length };
}

function readOutbox() {
    try {
        const raw = localStorage.getItem(OUTBOX_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        void e;
        return [];
    }
}

function writeOutbox(list) {
    try {
        localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(-500)));
    } catch (e) {
        void e;
    }
}

export function outboxSize(pollId) {
    return readOutbox().filter((e) => e.pollId === pollId).length;
}

export function outboxEntries(pollId) {
    return readOutbox().filter((e) => e.pollId === pollId);
}

export function enqueueVote(entry) {
    const list = readOutbox();
    list.push({ ...entry, tries: 0, queuedAt: Date.now() });
    writeOutbox(list);
}

function dequeueVote(voteId) {
    writeOutbox(readOutbox().filter((e) => e.voteId !== voteId));
}

export async function flushOutbox(pollId, castFn) {
    const entries = outboxEntries(pollId);
    let sent = 0;
    for (const entry of entries) {
        try {
            const res = await castFn(entry);
            if (res.status === 'counted' || res.status === 'duplicate') {
                dequeueVote(entry.voteId);
                sent += 1;
            } else if (
                res.status === 'closed' ||
                res.status === 'bad-class' ||
                res.status === 'no-poll' ||
                res.status === 'class-sealed'
            ) {
                if (res.status === 'class-sealed') recordSealedDrop(pollId, entry.classKey);
                dequeueVote(entry.voteId);
            } else {
                const list = readOutbox().map((e) =>
                    e.voteId === entry.voteId ? { ...e, tries: (e.tries || 0) + 1 } : e
                );
                writeOutbox(list);
                break;
            }
        } catch (e) {
            void e;
            break;
        }
    }
    return sent;
}

export function outboxSummary(pollId) {
    const entries = outboxEntries(pollId);
    if (!entries.length) return null;
    const oldest = Math.min(...entries.map((e) => e.queuedAt || Date.now()));
    return { count: entries.length, oldest };
}

const DROPS_KEY = 'rmv.sealedDrops.v1';

function readDrops() {
    try {
        const parsed = JSON.parse(localStorage.getItem(DROPS_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
        void e;
        return {};
    }
}

function recordSealedDrop(pollId, classKey) {
    const drops = readDrops();
    const key = pollId + ':' + classKey;
    drops[key] = (drops[key] || 0) + 1;
    try {
        localStorage.setItem(DROPS_KEY, JSON.stringify(drops));
    } catch (e) {
        void e;
    }
}

export function sealedDrops(pollId, classKey) {
    return readDrops()[pollId + ':' + classKey] || 0;
}

export function clearSealedDrops(pollId, classKey) {
    const drops = readDrops();
    delete drops[pollId + ':' + classKey];
    try {
        localStorage.setItem(DROPS_KEY, JSON.stringify(drops));
    } catch (e) {
        void e;
    }
}
