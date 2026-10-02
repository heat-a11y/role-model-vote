import http from 'node:http';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { defaultPoll, normalisePoll, normaliseClassKey } from '../js/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml'
};
const POLL_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const VOTE_ID_RE = /^[A-Za-z0-9_-]{8,120}$/;
const MAX_BODY = 1024 * 1024;

function json(res, status, body) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(body));
}

async function readBody(req) {
    let body = '';
    for await (const chunk of req) {
        body += chunk;
        if (body.length > MAX_BODY) {
            const err = new Error('Request body is too large');
            err.status = 413;
            throw err;
        }
    }
    try {
        return body ? JSON.parse(body) : {};
    } catch {
        const err = new Error('Request body must be valid JSON');
        err.status = 400;
        throw err;
    }
}

function lanAddresses() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const ni of list || []) {
            if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
        }
    }
    return out;
}

export function createServer({ dataDir = path.join(root, 'data') } = {}) {
    const polls = new Map();
    const listeners = new Map();
    let queue = Promise.resolve();

    function serialize(task) {
        const result = queue.then(task, task);
        queue = result.catch(() => {});
        return result;
    }

    async function loadPoll(id) {
        if (polls.has(id)) return polls.get(id);
        const file = path.join(dataDir, id + '.json');
        try {
            const stored = JSON.parse(await fs.readFile(file, 'utf8'));
            if (!stored || !stored.poll || !Array.isArray(stored.votes)) {
                throw new Error('Saved ballot data is malformed: ' + file);
            }
            const data = { poll: normalisePoll(stored.poll), votes: stored.votes };
            polls.set(id, data);
            return data;
        } catch (err) {
            if (err.code === 'ENOENT') return null;
            throw err;
        }
    }

    async function savePoll(id, data) {
        await fs.mkdir(dataDir, { recursive: true });
        const file = path.join(dataDir, id + '.json');
        const temp = file + '.' + process.pid + '.tmp';
        await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
        await fs.rename(temp, file);
        polls.set(id, data);
    }

    async function waitForWrites() {
        await queue;
    }

    function publish(id, data) {
        const peers = listeners.get(id);
        if (!peers) return;
        const message = 'data: ' + JSON.stringify({ poll: data.poll }) + '\n\n';
        for (const res of peers) res.write(message);
    }

    function requirePollId(raw) {
        if (!POLL_ID_RE.test(raw || '')) {
            const err = new Error('Invalid ballot ID');
            err.status = 400;
            throw err;
        }
        return raw;
    }

    async function handleApi(req, res, url) {
        const match = /^\/api\/polls\/([^/]+)(?:\/(ensure|events|votes|reset))?$/.exec(url.pathname);
        if (!match) return false;

        let id;
        try {
            id = requirePollId(decodeURIComponent(match[1]));
        } catch (err) {
            json(res, err.status || 400, { error: err.message });
            return true;
        }

        const action = match[2] || '';
        try {
            if (action === 'events' && req.method === 'GET') {
                await waitForWrites();
                const data = await loadPoll(id);
                if (!data) {
                    json(res, 404, { error: 'Ballot not found' });
                    return true;
                }
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-cache, no-transform',
                    Connection: 'keep-alive',
                    'X-Accel-Buffering': 'no'
                });
                res.write('retry: 1000\n\n');
                res.write('data: ' + JSON.stringify({ poll: data.poll }) + '\n\n');
                if (!listeners.has(id)) listeners.set(id, new Set());
                listeners.get(id).add(res);
                res.on('close', () => {
                    listeners.get(id)?.delete(res);
                    if (listeners.get(id)?.size === 0) listeners.delete(id);
                });
                return true;
            }

            if (action === 'ensure' && req.method === 'POST') {
                const data = await serialize(async () => {
                    const existing = await loadPoll(id);
                    if (existing) return existing;
                    const created = { poll: defaultPoll(), votes: [] };
                    await savePoll(id, created);
                    return created;
                });
                json(res, 200, { poll: data.poll });
                return true;
            }

            if (action === 'votes' && req.method === 'GET') {
                await waitForWrites();
                const data = await loadPoll(id);
                if (!data) {
                    json(res, 404, { error: 'Ballot not found' });
                    return true;
                }
                json(res, 200, data.votes);
                return true;
            }

            if (action === 'votes' && req.method === 'POST') {
                const body = await readBody(req);
                const result = await serialize(async () => {
                    const existing = await loadPoll(id);
                    if (!existing) return { status: 'no-poll' };
                    const data = structuredClone(existing);
                    const { voteId, optionIndex, optionId, classKey } = body;
                    if (typeof voteId !== 'string' || !VOTE_ID_RE.test(voteId) ||
                        !Number.isInteger(optionIndex) || typeof classKey !== 'string' ||
                        normaliseClassKey(classKey) !== classKey) {
                        return { status: 'bad-vote' };
                    }
                    if (data.votes.some((vote) => vote.id === voteId)) return { status: 'duplicate' };
                    const poll = data.poll;
                    if (poll.active !== true) return { status: 'closed' };
                    const option = poll.options[optionIndex];
                    if (!option || (optionId && option.id !== optionId)) {
                        return { status: option ? 'stale-option' : 'bad-option', options: poll.options };
                    }
                    if (!poll.classes[classKey]) return { status: 'bad-class' };
                    if (poll.sealed[classKey] === true) return { status: 'class-sealed' };

                    option.votes += 1;
                    poll.totalVotes += 1;
                    poll.classes[classKey].votes += 1;
                    poll.updatedAt = new Date().toISOString();
                    data.votes.push({
                        id: voteId,
                        optionIndex,
                        optionId: option.id,
                        optionText: option.text,
                        classKey,
                        at: poll.updatedAt
                    });
                    await savePoll(id, data);
                    publish(id, data);
                    return { status: 'counted', total: poll.totalVotes };
                });
                json(res, 200, result);
                return true;
            }

            if (action === 'reset' && req.method === 'POST') {
                const data = await serialize(async () => {
                    const existing = await loadPoll(id);
                    if (!existing) return null;
                    const current = structuredClone(existing);
                    current.poll.options = current.poll.options.map((option) => ({ ...option, votes: 0 }));
                    current.poll.totalVotes = 0;
                    current.poll.classes = Object.fromEntries(
                        Object.entries(current.poll.classes).map(([key, value]) => [
                            key,
                            { ...value, votes: 0 }
                        ])
                    );
                    current.poll.active = false;
                    current.poll.sealed = {};
                    current.poll.updatedAt = new Date().toISOString();
                    current.votes = [];
                    await savePoll(id, current);
                    publish(id, current);
                    return current;
                });
                if (!data) json(res, 404, { error: 'Ballot not found' });
                else json(res, 200, { poll: data.poll });
                return true;
            }

            if (!action && req.method === 'GET') {
                await waitForWrites();
                const data = await loadPoll(id);
                if (!data) json(res, 404, { error: 'Ballot not found' });
                else json(res, 200, data.poll);
                return true;
            }

            if (!action && req.method === 'PATCH') {
                const patch = await readBody(req);
                const data = await serialize(async () => {
                    const existing = await loadPoll(id);
                    if (!existing) return null;
                    const current = structuredClone(existing);
                    const allowed = ['title', 'subtitle', 'active', 'options', 'classes', 'sealed'];
                    if (!patch || typeof patch !== 'object' ||
                        Object.keys(patch).some((key) => !allowed.includes(key))) {
                        const err = new Error('Invalid ballot update');
                        err.status = 400;
                        throw err;
                    }
                    if (current.poll.active && Object.keys(patch).some((key) =>
                        ['title', 'subtitle', 'options', 'classes'].includes(key))) {
                        const err = new Error('Close voting before editing the ballot');
                        err.status = 409;
                        throw err;
                    }
                    const next = {
                        ...current.poll,
                        ...patch,
                        updatedAt: new Date().toISOString()
                    };
                    current.poll = normalisePoll(next);
                    if (Object.hasOwn(patch, 'options') || Object.hasOwn(patch, 'classes')) {
                        const optionsById = new Map(current.poll.options.map((option, index) => [
                            option.id,
                            { option, index }
                        ]));
                        const classVotes = Object.fromEntries(
                            Object.keys(current.poll.classes).map((key) => [key, 0])
                        );
                        current.votes = current.votes.filter((vote) =>
                            optionsById.has(vote.optionId) && Object.hasOwn(current.poll.classes, vote.classKey)
                        );
                        for (const option of current.poll.options) option.votes = 0;
                        for (const vote of current.votes) {
                            const currentOption = optionsById.get(vote.optionId);
                            vote.optionIndex = currentOption.index;
                            vote.optionText = currentOption.option.text;
                            currentOption.option.votes += 1;
                            classVotes[vote.classKey] += 1;
                        }
                        for (const [key, count] of Object.entries(classVotes)) {
                            current.poll.classes[key].votes = count;
                        }
                        current.poll.totalVotes = current.votes.length;
                    }
                    await savePoll(id, current);
                    publish(id, current);
                    return current;
                });
                if (!data) json(res, 404, { error: 'Ballot not found' });
                else json(res, 200, { poll: data.poll });
                return true;
            }

            json(res, 405, { error: 'Method not allowed' });
            return true;
        } catch (err) {
            json(res, err.status || 500, { error: err.message || 'Local server error' });
            return true;
        }
    }

    return http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname.startsWith('/api/')) {
            if (await handleApi(req, res, url)) return;
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('Method not allowed');
        }

        let pathname;
        try {
            pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        } catch {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('Invalid path');
        }
        const file = path.resolve(root, '.' + pathname);
        const storage = path.resolve(dataDir);
        if ((file !== root && !file.startsWith(root + path.sep)) ||
            file === storage || file.startsWith(storage + path.sep)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('Forbidden');
        }
        try {
            const stat = await fs.stat(file);
            if (!stat.isFile()) throw new Error('Not a file');
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
            if (req.method === 'HEAD') return res.end();
            createReadStream(file).pipe(res);
        } catch {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
        }
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const port = Number(process.env.PORT || 8080);
    const server = createServer();
    server.listen(port, '0.0.0.0', () => {
        console.log('\nRole Model Vote is running on this laptop.\n');
        console.log('  Master dashboard:');
        console.log('    http://localhost:' + port + '/dashboard.html\n');
        for (const ip of lanAddresses()) {
            console.log('  Open on the six voting laptops and the projector (same Wi-Fi):');
            console.log('    http://' + ip + ':' + port + '/dashboard.html');
            console.log('    http://' + ip + ':' + port + '/kiosk.html?class=3A');
            console.log('    http://' + ip + ':' + port + '/reveal.html\n');
        }
        console.log('  Votes are saved on this laptop in data/. Press Ctrl+C to stop.\n');
    });
}
