const DB = Symbol('db');

class DocRef {
    constructor(path) {
        this.path = path;
        this.type = 'doc';
    }
    get id() {
        return this.path[this.path.length - 1];
    }
}

class CollRef {
    constructor(path) {
        this.path = path;
        this.type = 'collection';
    }
}

class Snapshot {
    constructor(path, value) {
        this.path = path;
        this.value = value;
        this.exists = () => value !== undefined;
    }
    data() {
        return this.value === undefined ? undefined : JSON.parse(JSON.stringify(this.value));
    }
}

const INC = Symbol('increment');
const STAMP = Symbol('serverTimestamp');
const UNSET = Symbol('unset');

export const increment = (n) => ({ [INC]: n });
export const serverTimestamp = () => ({ [STAMP]: true });
export const deleteField = () => ({ [UNSET]: true });

export function doc(_db, ...path) {
    return new DocRef(path);
}

export function collection(_db, ...path) {
    return new CollRef(path);
}

export function query(coll) {
    return { coll };
}

function getPath(obj, dotted) {
    const parts = dotted.split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}

function setPath(obj, dotted, value) {
    const parts = dotted.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i += 1) {
        const key = parts[i];
        const nextIsIndex = /^\d+$/.test(parts[i + 1]);
        if (cur[key] == null) cur[key] = nextIsIndex ? [] : {};
        cur = cur[key];
    }
    cur[parts[parts.length - 1]] = value;
}

function delPath(obj, dotted) {
    const parts = dotted.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i += 1) {
        cur = cur[parts[i]];
        if (cur == null) return;
    }
    delete cur[parts[parts.length - 1]];
}

function isDotKey(key) {
    return /[.[]/.test(key);
}

function resolveSentinels(value) {
    if (Array.isArray(value)) return value.map(resolveSentinels);
    if (value && typeof value === 'object') {
        if (value[INC] !== undefined) return value[INC];
        if (value[STAMP]) return { __ts: 1 };
        if (value[UNSET]) return undefined;
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            const r = resolveSentinels(v);
            if (r !== undefined) out[k] = r;
        }
        return out;
    }
    return value;
}

export const __store = new Map();
export const __listeners = [];
let __mutex = Promise.resolve();

const key = (path) => path.join('/');

function readDoc(path) {
    const v = __store.get(key(path));
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function writeDoc(path, data) {
    __store.set(key(path), JSON.parse(JSON.stringify(data)));
}

export function getFirestore() {
    return { __db: true };
}

export async function getDoc(ref) {
    await new Promise((r) => setTimeout(r, 1));
    return new Snapshot(ref.path, readDoc(ref.path));
}

export async function getDocs(q) {
    await new Promise((r) => setTimeout(r, 1));
    const base = q.coll.path.join('/') + '/';
    const rows = [];
    for (const [k, v] of __store.entries()) {
        if (k.startsWith(base)) {
            const rest = k.slice(base.length);
            if (!rest.includes('/')) rows.push({ id: rest, ...JSON.parse(JSON.stringify(v)) });
        }
    }
    return { docs: rows.map((r) => ({ id: r.id, data: () => r })) };
}

export function onSnapshot(ref, onData, onError) {
    const entry = { ref, onData, onError };
    __listeners.push(entry);
    const v = readDoc(ref.path);
    setTimeout(() => {
        if (v !== undefined) onData(new Snapshot(ref.path, v));
        else onData(new Snapshot(ref.path, undefined));
    }, 0);
    return () => {
        const i = __listeners.indexOf(entry);
        if (i >= 0) __listeners.splice(i, 1);
    };
}

function notify() {
    for (const l of __listeners.slice()) {
        const v = readDoc(l.ref.path);
        try {
            l.onData(new Snapshot(l.ref.path, v));
        } catch (e) {
            if (l.onError) l.onError(e);
        }
    }
}

function applyWrite(path, data) {
    const resolved = resolveSentinels(data);
    const keys = Object.keys(resolved);
    if (!keys.length) return;
    const cur = readDoc(path) || {};
    for (const k of keys) {
        const v = resolved[k];
        if (isDotKey(k)) {
            if (v === undefined) delPath(cur, k);
            else setPath(cur, k, v);
        } else if (v === undefined) {
            delete cur[k];
        } else {
            cur[k] = v;
        }
    }
    writeDoc(path, cur);
}

function applyIncrements(path, data) {
    const cur = readDoc(path) || {};
    let touched = false;
    for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && v[INC] !== undefined) {
            const existing = getPath(cur, k) || 0;
            setPath(cur, k, existing + v[INC]);
            touched = true;
        }
    }
    if (touched) writeDoc(path, cur);
}

function applyStamps(path, data) {
    const cur = readDoc(path) || {};
    let touched = false;
    for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && v[STAMP]) {
            setPath(cur, k, { __ts: 1 });
            touched = true;
        }
    }
    if (touched) writeDoc(path, cur);
}

export async function setDoc(ref, data, opts) {
    await new Promise((r) => setTimeout(r, 1));
    if (opts && opts.merge) {
        const cur = readDoc(ref.path) || {};
        const resolved = resolveSentinels(data);
        for (const [k, v] of Object.entries(resolved)) {
            if (v === undefined) delete cur[k];
            else cur[k] = v;
        }
        applyStamps(ref.path, data);
        writeDoc(ref.path, cur);
    } else {
        applyWrite(ref.path, data);
    }
    notify();
}

export async function updateDoc(ref, data) {
    await new Promise((r) => setTimeout(r, 1));
    applyIncrements(ref.path, data);
    const nonIncr = {};
    for (const [k, v] of Object.entries(data)) {
        if (!(v && typeof v === 'object' && v[INC] !== undefined)) nonIncr[k] = v;
    }
    applyWrite(ref.path, nonIncr);
    applyStamps(ref.path, data);
    notify();
}

export async function runTransaction(_db, fn) {
    let release;
    const turn = new Promise((r) => {
        release = r;
    });
    const prev = __mutex;
    __mutex = prev.then(() => turn);
    await prev;

    const reads = new Map();
    const sets = [];
    const updates = [];
    const tx = {
        get: async (ref) => {
            if (reads.has(key(ref.path))) {
                return new Snapshot(ref.path, reads.get(key(ref.path)));
            }
            const v = readDoc(ref.path);
            reads.set(key(ref.path), v);
            return new Snapshot(ref.path, v);
        },
        update: (ref, data) => {
            updates.push({ ref, data });
        },
        set: (ref, data) => {
            sets.push({ ref, data });
        }
    };

    let result;
    try {
        result = await fn(tx);
        for (const { ref, data } of updates) {
            applyIncrements(ref.path, data);
            const nonIncr = {};
            for (const [k, v] of Object.entries(data)) {
                if (!(v && typeof v === 'object' && v[INC] !== undefined)) nonIncr[k] = v;
            }
            applyWrite(ref.path, nonIncr);
            applyStamps(ref.path, data);
        }
        for (const { ref, data } of sets) {
            writeDoc(ref.path, resolveSentinels(data));
        }
        notify();
    } finally {
        release();
    }
    return result;
}

export async function enableNetwork() {}
export async function disableNetwork() {}
export function connectFirestoreEmulator() {}

if (typeof window !== 'undefined') {
    window.__testApi = {
        __store,
        __listeners,
        doc,
        collection,
        setDoc,
        getDoc,
        updateDoc,
        increment,
        serverTimestamp
    };
}
