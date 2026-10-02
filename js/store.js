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
    await request('/api/polls/' + encodeURIComponent(pollId) + '/ensure', { method: 'POST' });
    return true;
}

export function subscribePoll(pollId, onData, onError) {
    const source = new EventSource('/api/polls/' + encodeURIComponent(pollId) + '/events');
    source.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.poll) onData(normalisePoll(data.poll));
        } catch (err) {
            if (onError) onError(err);
        }
    };
    source.onerror = () => {
        if (onError) onError(new Error('Lost the connection to the local voting server.'));
    };
    return () => source.close();
}

export async function castVote({ pollId, optionIndex, optionId, classKey, voteId }) {
    return request('/api/polls/' + encodeURIComponent(pollId) + '/votes', {
        method: 'POST',
        body: JSON.stringify({ optionIndex, optionId, classKey, voteId })
    });
}

export async function savePoll(pollId, patch) {
    await request('/api/polls/' + encodeURIComponent(pollId), {
        method: 'PATCH',
        body: JSON.stringify(patch)
    });
}

export async function setVotingOpen(pollId, open) {
    await savePoll(pollId, { active: open === true });
}

export async function setClassSealed(pollId, classKey, sealed) {
    const current = await request('/api/polls/' + encodeURIComponent(pollId));
    const next = { ...current.sealed };
    if (sealed) {
        next[classKey] = true;
    } else {
        delete next[classKey];
    }
    await savePoll(pollId, { sealed: next });
}

export async function resetVotes(pollId) {
    await request('/api/polls/' + encodeURIComponent(pollId) + '/reset', {
        method: 'POST'
    });
}

export async function readLedger(pollId) {
    return request('/api/polls/' + encodeURIComponent(pollId) + '/votes');
}

async function request(url, options = {}) {
    let response;
    try {
        response = await fetch(url, {
            ...options,
            headers: {
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...options.headers
            }
        });
    } catch (err) {
        err.code = 'unavailable';
        throw err;
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        const err = new Error(result.error || 'Local voting server returned HTTP ' + response.status);
        err.code = result.code || 'server-error';
        throw err;
    }
    return result;
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
