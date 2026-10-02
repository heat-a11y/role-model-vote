import { initFirebase, describeAuthError, isOfflineError, forceReconnect, configReady } from './firebase.js';
import {
    ensurePoll,
    subscribePoll,
    castVote,
    normaliseClassKey,
    outboxSize,
    enqueueVote,
    flushOutbox,
    newId,
    escapeHtml
} from './store.js';
import { icon, dot } from './ui.js';
import { burst } from './confetti.js';

const params = new URLSearchParams(location.search);
const POLL_ID = params.get('poll') || 'role-model-2026';
const LS_CLASS = 'rmv.class.' + POLL_ID;

const GRADIENTS = [
    'from-indigo-600 to-blue-700 border-indigo-400/40',
    'from-violet-600 to-purple-700 border-violet-400/40',
    'from-emerald-600 to-teal-700 border-emerald-400/40',
    'from-amber-500 to-orange-700 border-amber-400/40',
    'from-rose-600 to-pink-700 border-rose-400/40',
    'from-cyan-600 to-blue-800 border-cyan-400/40',
    'from-fuchsia-600 to-purple-700 border-fuchsia-400/40',
    'from-lime-600 to-green-700 border-lime-400/40'
];

const state = {
    phase: 'boot',
    poll: null,
    classKey: normaliseClassKey(params.get('class') || localStorage.getItem(LS_CLASS) || ''),
    net: 'init',
    held: 0,
    error: '',
    holdReason: ''
};

let view = document.getElementById('view');
let idleTimer = 0;
let lastSignature = '';
let flushTimer = 0;

const netPill = document.getElementById('net-pill');
const heldPill = document.getElementById('held-pill');
const toastEl = document.getElementById('toast');
const toastMsg = document.getElementById('toast-msg');

document.getElementById('hd-icon').innerHTML = icon('users', 'w-5 h-5');
document.getElementById('hd-title').textContent = 'Role Model Vote';

function toast(msg, ms = 2600) {
    toastMsg.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
        toastEl.style.opacity = '0';
    }, ms);
}

function signature() {
    const p = state.poll;
    if (!p) return 'none';
    return [
        state.phase,
        p.active,
        p.title,
        p.subtitle,
        state.classKey,
        p.options.map((o) => o.id + ':' + o.text).join('|'),
        Object.keys(p.classes).join(','),
        state.net,
        state.held,
        state.holdReason,
        state.error
    ].join('~');
}

function card(inner, cls = '') {
    return '<div class="w-full max-w-md mx-auto ' + cls + '">' + inner + '</div>';
}

function bigScreen(opts) {
    return (
        '<div class="flex-1 flex flex-col items-center justify-center p-6 text-center animate-fade-in">' +
        '<div class="w-24 h-24 rounded-full flex items-center justify-center mb-6 ' + opts.tone + '">' +
        icon(opts.icon, 'w-12 h-12') +
        '</div>' +
        '<h2 class="text-3xl md:text-4xl font-extrabold text-white mb-2">' + opts.title + '</h2>' +
        '<p class="text-slate-400 text-lg max-w-md">' + opts.msg + '</p>' +
        (opts.extra || '') +
        '</div>'
    );
}

function setupScreen() {
    const known = state.poll ? Object.keys(state.poll.classes) : [];
    const list = known.length
        ? known
              .map(
                  (k) =>
                      '<button class="option-card bg-gradient-to-br from-slate-700 to-slate-800 border-slate-600 text-left" data-class="' +
                      escapeHtml(k) +
                      '"><span class="text-xl md:text-2xl font-bold text-white">' +
                      escapeHtml(k) +
                      '</span><span class="text-slate-300 text-sm mt-1 block">Tap to use this class</span></button>'
              )
              .join('')
        : '';
    const warn = state.error
        ? '<div class="mt-6 p-4 rounded-xl bg-rose-950/60 border border-rose-700 text-rose-200 text-sm text-left">' +
          icon('warn', 'w-5 h-5 inline mr-2') +
          escapeHtml(state.error) +
          '</div>'
        : '';

    return (
        card(
            '<div class="card p-8 animate-fade-in">' +
                '<div class="w-16 h-16 rounded-2xl bg-indigo-500/15 text-indigo-300 flex items-center justify-center mx-auto mb-5">' +
                icon('users', 'w-8 h-8') +
                '</div>' +
                '<h2 class="text-2xl font-extrabold text-white mb-1">Which class is this?</h2>' +
                '<p class="text-slate-400 text-sm mb-6">Set this once. Every vote from this laptop is counted against this class.</p>' +
                (list ? '<div class="grid gap-3 mb-5">' + list + '</div>' : '') +
                '<input id="class-input" class="field mb-3" placeholder="e.g. 3A" maxlength="40" value="">' +
                '<button id="class-save" class="btn btn-primary btn-lg w-full">' +
                icon('check', 'w-5 h-5') +
                '<span>Start voting</span></button>' +
                warn +
                '</div>',
            'p-6'
        )
    );
}

function gateScreen() {
    const total = state.poll ? state.poll.totalVotes : 0;
    return bigScreen({
        icon: 'lock',
        tone: 'bg-amber-500/20 text-amber-300',
        title: 'Voting is closed',
        msg:
            'Please wait for your teacher to open the vote. The results so far are safely recorded &mdash; ' +
            total +
            ' vote' +
            (total === 1 ? '' : 's') +
            ' counted.',
        extra:
            state.held > 0
                ? '<div class="mt-6 p-4 rounded-xl bg-amber-950/60 border border-amber-700 text-amber-200 text-sm">' +
                  icon('wifi', 'w-5 h-5 inline mr-2') +
                  state.held +
                  ' vote' +
                  (state.held === 1 ? '' : 's') +
                  ' from this laptop still waiting to sync.</div>'
                : ''
    });
}

function offlineScreen() {
    return bigScreen({
        icon: 'wifi',
        tone: 'bg-rose-500/20 text-rose-300',
        title: 'No connection',
        msg:
            'This laptop cannot reach the server, so votes cannot be saved right now. Tell your teacher. ' +
            'Anything already voted is safely held on this laptop and will sync automatically.',
        extra:
            '<button class="btn btn-primary btn-lg mt-7" id="retry-net">' +
            icon('refresh', 'w-5 h-5') +
            '<span>Try again</span></button>'
    });
}

function errorScreen() {
    return bigScreen({
        icon: 'warn',
        tone: 'bg-rose-500/20 text-rose-300',
        title: 'Cannot connect',
        msg: state.error,
        extra:
            '<button class="btn btn-primary btn-lg mt-7" id="retry-net">' +
            icon('refresh', 'w-5 h-5') +
            '<span>Try again</span></button>'
    });
}

function optionButtons() {
    return state.poll.options
        .map((opt, i) => {
            const grad = GRADIENTS[i % GRADIENTS.length];
            return (
                '<button class="option-card bg-gradient-to-br ' +
                grad +
                ' hover:brightness-110" data-opt="' +
                i +
                '" data-oid="' +
                escapeHtml(opt.id) +
                '">' +
                '<div class="flex items-start justify-between w-full gap-2">' +
                '<span class="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center text-white font-extrabold">' +
                (i + 1) +
                '</span>' +
                '<span class="text-white/70 text-xs font-semibold uppercase tracking-wide pt-2">Tap to vote</span>' +
                '</div>' +
                '<span class="text-xl md:text-3xl font-bold text-white mt-4 leading-tight">' +
                escapeHtml(opt.text) +
                '</span></button>'
            );
        })
        .join('');
}

function idleScreen() {
    const p = state.poll;
    return (
        '<div class="flex-1 flex flex-col items-center justify-center p-4 md:p-6 w-full min-h-0">' +
        '<div class="text-center mb-5 shrink-0">' +
        '<h2 class="text-2xl md:text-4xl font-extrabold text-white tracking-tight leading-tight">' +
        escapeHtml(p.title) +
        '</h2>' +
        (p.subtitle
            ? '<p class="text-slate-400 text-sm md:text-base mt-2">' + escapeHtml(p.subtitle) + '</p>'
            : '') +
        '<p class="text-slate-500 text-xs mt-2">One tap each &mdash; after you vote the screen resets for the next person.</p>' +
        '</div>' +
        '<div id="options" class="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-4xl">' +
        optionButtons() +
        '</div>' +
        '</div>'
    );
}

function savingScreen() {
    return bigScreen({
        icon: 'clock',
        tone: 'bg-slate-700/60 text-slate-200 animate-pulse',
        title: 'Saving your vote&hellip;',
        msg: 'Just a moment.'
    });
}

function resultScreen(ok) {
    if (ok) {
        return (
            '<div class="flex-1 flex flex-col items-center justify-center p-6 text-center animate-pop-in">' +
            '<div class="w-24 h-24 bg-emerald-500/20 text-emerald-300 rounded-full flex items-center justify-center mb-5">' +
            icon('check', 'w-12 h-12') +
            '</div>' +
            '<h2 class="text-4xl font-extrabold text-white mb-2">Vote recorded</h2>' +
            '<p class="text-slate-400 text-xl">Thank you! Next voter, please step up.</p>' +
            '<p class="text-slate-600 text-sm mt-6">Tap anywhere to vote &mdash; the screen resets automatically</p>' +
            '</div>'
        );
    }
    const offline = state.holdReason === 'offline';
    return (
        '<div class="flex-1 flex flex-col items-center justify-center p-6 text-center animate-pop-in">' +
        '<div class="w-24 h-24 bg-amber-500/20 text-amber-300 rounded-full flex items-center justify-center mb-5">' +
        icon(offline ? 'clock' : 'warn', 'w-12 h-12') +
        '</div>' +
        '<h2 class="text-3xl font-extrabold text-white mb-2">Vote held on this laptop</h2>' +
        (offline
            ? '<p class="text-slate-300 text-xl max-w-lg">There is no connection at the moment. Your choice is stored ' +
              'here and will be counted as soon as the network is back &mdash; you do not need to vote again.</p>'
            : '<p class="text-amber-200 text-lg max-w-lg">' +
              escapeHtml(state.error || 'The server could not accept the vote.') +
              '</p><p class="text-slate-400 text-sm mt-2">Your choice is stored on this laptop. Tell your teacher, ' +
              'who can read it back from the master dashboard.</p>') +
        '<p class="text-slate-500 text-sm mt-6">Next voter, please step up</p>' +
        '</div>'
    );
}

function render(force) {
    state.held = outboxSize(POLL_ID);
    const sig = signature();
    if (!force && sig === lastSignature) return;
    lastSignature = sig;

    const p = state.poll;
    const classLabel = state.classKey ? 'Class ' + state.classKey : 'Class not set';
    document.getElementById('hd-class').textContent = classLabel;

    netPill.innerHTML = dot(state.net) + '<span>' +
        (state.net === 'live' ? 'Connected' : state.net === 'pending' ? 'Syncing' : state.net === 'down' ? 'Offline' : 'Starting') +
        '</span>';
    netPill.className =
        'pill ' +
        (state.net === 'live'
            ? 'bg-emerald-500/15 text-emerald-300'
            : state.net === 'down'
              ? 'bg-rose-500/15 text-rose-300'
              : 'bg-slate-800 text-slate-300');

    const held = state.held;
    heldPill.hidden = held === 0;
    heldPill.innerHTML = icon('clock', 'w-3.5 h-3.5') + '<span>' + held + ' waiting to sync</span>';
    heldPill.className = 'pill bg-amber-500/15 text-amber-300';

    let html;
    if (state.phase === 'boot') {
        html = bigScreen({ icon: 'clock', tone: 'bg-slate-700/60 text-slate-200 animate-pulse', title: 'Connecting&hellip;', msg: ' ' });
    } else if (state.phase === 'setup') {
        html = setupScreen();
    } else if (state.phase === 'error') {
        html = errorScreen();
    } else if (state.phase === 'offline') {
        html = offlineScreen();
    } else if (state.phase === 'closed') {
        html = gateScreen();
    } else if (state.phase === 'saving') {
        html = savingScreen();
    } else if (state.phase === 'saved') {
        html = resultScreen(true);
    } else if (state.phase === 'held') {
        html = resultScreen(false);
    } else {
        html = idleScreen();
    }
    view.innerHTML = html;
    wire();
}

function wire() {
    const saveBtn = document.getElementById('class-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', commitClass);
        const input = document.getElementById('class-input');
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') commitClass();
            });
        }
    }
    for (const el of view.querySelectorAll('[data-class]')) {
        el.addEventListener('click', () => setClass(el.dataset.class));
    }
    for (const el of view.querySelectorAll('[data-opt]')) {
        el.addEventListener('click', () => vote(Number(el.dataset.opt), el.dataset.oid));
    }
    const retry = document.getElementById('retry-net');
    if (retry) {
        retry.addEventListener('click', async () => {
            state.phase = 'boot';
            state.error = '';
            render(true);
            await boot();
        });
    }
}

function commitClass() {
    const input = document.getElementById('class-input');
    if (!input) return;
    setClass(input.value);
}

function setClass(raw) {
    const key = normaliseClassKey(raw);
    if (!key) {
        toast('Use letters, numbers, - or _ only (max 40 characters)');
        return;
    }
    state.classKey = key;
    localStorage.setItem(LS_CLASS, key);
    state.phase = state.poll && state.poll.active ? 'idle' : 'closed';
    render(true);
    if (navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request('screen').catch(() => {});
    }
}

function scheduleIdle(ms) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        if (!state.poll) return;
        if (state.phase === 'saved' || state.phase === 'held') {
            state.phase = state.poll.active ? 'idle' : 'closed';
            render(true);
        }
    }, ms);
}

async function vote(index, optionId) {
    if (state.phase === 'saving' || state.phase === 'boot') return;
    if (!state.poll || state.poll.active !== true) {
        state.phase = 'closed';
        render(true);
        return;
    }
    if (!state.classKey) {
        state.phase = 'setup';
        render(true);
        return;
    }

    clearTimeout(idleTimer);
    state.phase = 'saving';
    render(true);

    const entry = {
        voteId: newId(),
        pollId: POLL_ID,
        optionIndex: index,
        optionId: optionId,
        classKey: state.classKey
    };

    try {
        const res = await castVote(entry);
        if (res.status === 'counted' || res.status === 'duplicate') {
            state.net = 'live';
            state.phase = 'saved';
            render(true);
            burst(80);
            scheduleIdle(2200);
        } else if (res.status === 'closed') {
            state.phase = 'closed';
            render(true);
            toast('Voting was just closed by the teacher');
        } else if (res.status === 'stale-option' || res.status === 'bad-option') {
            if (Array.isArray(res.options)) state.poll.options = res.options;
            state.phase = 'idle';
            render(true);
            toast('The list just changed &mdash; please tap your choice again');
        } else if (res.status === 'bad-class') {
            state.phase = 'setup';
            render(true);
            toast('This class is not on the master list. Ask your teacher to add it.');
        } else {
            handleFailure(entry, new Error(res.status || 'The server refused that vote.'));
        }
    } catch (err) {
        handleFailure(entry, err);
    }
}

function handleFailure(entry, err) {
    enqueueVote(entry);
    state.held = outboxSize(POLL_ID);
    if (isOfflineError(err)) {
        state.net = 'down';
        state.holdReason = 'offline';
        state.error = '';
    } else {
        state.net = 'pending';
        state.holdReason = 'error';
        state.error = describeAuthError(err);
    }
    state.phase = 'held';
    render(true);
    scheduleIdle(3000);
    if (state.holdReason === 'offline') startFlush();
}

function startFlush() {
    if (flushTimer) return;
    const attempt = async () => {
        flushTimer = 0;
        const before = outboxSize(POLL_ID);
        if (before === 0) {
            state.net = 'live';
            render(true);
            return;
        }
        state.net = 'pending';
        render(true);
        try {
            const sent = await flushOutbox(POLL_ID, castVote);
            const after = outboxSize(POLL_ID);
            if (after === 0) {
                state.net = 'live';
                render(true);
                if (sent > 0) toast(sent + ' held vote' + (sent === 1 ? '' : 's') + ' synced successfully');
                return;
            }
            if (after < before) {
                render(true);
            }
        } catch (e) {
            void e;
        }
        if (outboxSize(POLL_ID) > 0) {
            flushTimer = setTimeout(attempt, 4000);
        }
    };
    flushTimer = setTimeout(attempt, 1500);
}

function onPollData(poll) {
    const prevActive = state.poll ? state.poll.active : null;
    state.poll = poll;

    if (state.phase === 'boot' || state.phase === 'setup') {
        if (state.phase === 'boot') {
            state.phase = !state.classKey ? 'setup' : poll.active ? 'idle' : 'closed';
        }
    } else if (state.phase === 'idle' || state.phase === 'closed') {
        if (!poll.active) state.phase = 'closed';
        else if (!state.classKey) state.phase = 'setup';
        else if (prevActive === false) {
            state.phase = 'idle';
            toast('Voting is now open');
        }
    }

    if (state.net !== 'down') state.net = 'live';
    state.error = '';
    render();
}

function onPollError(err) {
    if (isOfflineError(err)) {
        state.net = 'down';
        if (state.phase === 'idle' || state.phase === 'closed') state.phase = 'offline';
        else state.phase = 'offline';
        render(true);
        startFlush();
    } else {
        state.error = describeAuthError(err);
        state.phase = 'error';
        render(true);
    }
}

async function boot() {
    if (!configReady) {
        state.phase = 'error';
        state.error =
            'js/firebase-config.js still has placeholder values. Follow the README to add your Firebase project keys, then reload.';
        render(true);
        return;
    }
    try {
        await initFirebase();
        await ensurePoll(POLL_ID);
        state.net = 'live';
        subscribePoll(POLL_ID, onPollData, onPollError);
        if (outboxSize(POLL_ID) > 0) startFlush();
        setTimeout(() => {
            if (state.phase === 'boot' && !state.poll) {
                state.phase = 'error';
                state.error =
                    'Connected, but the ballot does not exist yet. Open the master dashboard on the teacher laptop, ' +
                    'sign in, set the candidates and classes, then reload this screen.';
                render(true);
            }
        }, 8000);
    } catch (err) {
        if (isOfflineError(err)) {
            state.net = 'down';
            state.phase = 'offline';
        } else {
            state.error = describeAuthError(err);
            state.phase = 'error';
        }
        render(true);
    }
}

window.addEventListener('online', () => {
    if (!state.poll) return;
    forceReconnect().catch(() => {});
    startFlush();
});

window.addEventListener('pageshow', () => {
    if (state.phase === 'idle' || state.phase === 'closed') render(true);
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && outboxSize(POLL_ID) > 0) startFlush();
});

view.addEventListener('click', (e) => {
    if (state.phase === 'saved' || state.phase === 'held') {
        const opt = e.target.closest('[data-opt]');
        if (opt) return;
        if (!e.target.closest('button')) {
            clearTimeout(idleTimer);
            state.phase = state.poll && state.poll.active ? 'idle' : 'closed';
            render(true);
        }
    }
});

render(true);
boot();
