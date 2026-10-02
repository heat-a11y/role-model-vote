import { subscribePoll, escapeHtml } from './store.js';
import { tickSound, fanfare, dudSound, setMuted, isMuted } from './ui.js';
import { burst } from './confetti.js';

const POLL_ID = new URLSearchParams(location.search).get('poll') || 'role-model-2026';
const stage = document.getElementById('stage');

const COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e'];

const state = { poll: null, phase: 'load', shown: {} };
let timer = 0;

function ranked(p) {
    return p.options
        .slice()
        .sort((a, b) => b.votes - a.votes || a.text.localeCompare(b.text))
        .map((o, i) => ({
            id: o.id,
            text: o.text,
            votes: o.votes,
            share: p.totalVotes ? Math.round((o.votes / p.totalVotes) * 1000) / 10 : 0,
            color: o.color || COLORS[i % COLORS.length]
        }));
}

function pct(part, whole) {
    return whole ? Math.round((part / whole) * 100) : 0;
}

function classesLine(p) {
    const keys = Object.keys(p.classes);
    if (!keys.length) return '';
    const rows = keys
        .slice()
        .sort()
        .map((k) => '<span class="text-slate-500">' + escapeHtml(k) + '</span>');
    return '<p class="text-slate-500 text-sm mt-3">' + keys.length + ' classes &middot; ' +
        plural(p.totalVotes, 'vote') + ' counted' + rows.length + '</p>';
}

function plural(n, word) {
    return n === 1 ? '1 ' + word : n + ' ' + word + 's';
}

function bars(p, display) {
    const peak = Math.max(1, ...p.options.map((o) => o.votes));
    const total = p.totalVotes;
    return p.options
        .map((o, i) => ({
            id: o.id,
            text: o.text,
            color: o.color || COLORS[i % COLORS.length]
        }))
        .map((r) => {
            const shown = display[r.id] || 0;
            const width = peak ? (shown / peak) * 100 : 0;
            return (
                '<div class="w-full max-w-5xl text-left">' +
                '<div class="flex items-baseline justify-between gap-4 mb-2">' +
                '<span class="text-2xl md:text-4xl font-extrabold text-white truncate">' + escapeHtml(r.text) + '</span>' +
                '<span class="num text-3xl md:text-5xl font-black" style="color:' + r.color + '">' +
                shown + '</span></div>' +
                '<div class="rv-bar-track"><div class="rv-fill" data-fill="' + r.id + '" style="background:' +
                r.color + ';width:' + width.toFixed(2) + '%"></div></div>' +
                '<p class="text-xs text-slate-500 mt-1.5">' +
                (total ? pct(shown, total) + '%' : '&nbsp;') + '</p></div>'
            );
        })
        .join('');
}

function renderLoad() {
    stage.innerHTML =
        '<div class="animate-pulse text-slate-400 text-2xl">Loading the ballot&hellip;</div>';
}

function renderIdle(p) {
    const ready = p.totalVotes > 0;
    stage.innerHTML =
        '<div class="max-w-3xl">' +
        '<p class="text-sm uppercase tracking-[.3em] text-slate-500 mb-4">' +
        (p.active ? 'Voting is still open' : 'Voting is closed') + '</p>' +
        '<h1 class="text-4xl md:text-6xl font-black text-white mb-4">' +
        escapeHtml(p.title || 'School vote') + '</h1>' +
        (p.subtitle ? '<p class="text-lg text-slate-400 mb-8">' + escapeHtml(p.subtitle) + '</p>' : '<div class="mb-8"></div>') +
        '<p class="text-2xl text-slate-300 mb-8">' + plural(p.totalVotes, 'vote') + ' counted' +
        classesLine(p) + '</p>' +
        '<button id="begin" class="btn btn-primary text-xl px-10 py-5">' +
        (ready ? 'Reveal the result' : 'Show the result') + '</button>' +
        '<p class="text-xs text-slate-600 mt-6">Click, or press Space. Press M to mute.</p>' +
        '</div>';
    document.getElementById('begin')?.addEventListener('click', begin);
}

function renderCounting(p) {
    stage.innerHTML =
        '<h1 class="text-3xl md:text-5xl font-black text-white mb-2">Counting every vote&hellip;</h1>' +
        '<p class="text-slate-500 mb-6">' + plural(p.totalVotes, 'vote') + ' from ' +
        Object.keys(p.classes).length + ' classes</p>' +
        '<div class="w-full max-w-5xl flex flex-col gap-6">' + bars(p, state.shown) + '</div>' +
        '<p class="text-xs text-slate-600 mt-6">Press Space to skip to the end</p>';
    for (const [id, value] of Object.entries(state.shown)) {
        const el = stage.querySelector('[data-fill="' + id + '"]');
        if (el) el.style.width = value + '%';
    }
}

function renderWinner(p) {
    const top = ranked(p);
    const best = top[0].votes;
    const leaders = top.filter((r) => r.votes === best);
    const tied = leaders.length > 1;
    const total = p.totalVotes;

    const barsHtml = top
        .map(
            (r, i) =>
                '<div class="flex items-center gap-4">' +
                '<span class="num text-slate-600 text-lg md:text-2xl w-8">' + (i + 1) + '</span>' +
                '<span class="flex-1 text-left text-lg md:text-3xl font-bold ' +
                (r.votes === best ? 'text-white' : 'text-slate-400') + ' truncate">' +
                escapeHtml(r.text) + '</span>' +
                '<span class="num text-xl md:text-3xl font-black" style="color:' + r.color + '">' +
                r.votes + '</span>' +
                '<span class="num text-slate-500 text-lg md:text-2xl w-20 text-right">' +
                (total ? r.share + '%' : '0%') + '</span></div>'
        )
        .join('');

    const headline = tied
        ? '<h1 class="rv-name font-black text-white">A tie</h1>' +
          '<p class="text-3xl md:text-5xl font-bold text-amber-300 mt-4">' +
          leaders.map((r) => escapeHtml(r.text)).join(' &amp; ') + '</p>' +
          '<p class="text-xl text-slate-400 mt-6">Both finished on ' + plural(best, 'vote') + '. ' +
          'That is a real tie, so this app will not pick one for you.</p>'
        : '<p class="text-sm uppercase tracking-[.3em] text-emerald-400 mb-4">Our role model</p>' +
          '<h1 class="rv-name font-black text-white">' + escapeHtml(top[0].text) + '</h1>' +
          '<p class="text-2xl md:text-4xl font-bold mt-4" style="color:' + top[0].color + '">' +
          plural(top[0].votes, 'vote') + ' &middot; ' + top[0].share + '% of the vote</p>' +
          (best - (top[1] ? top[1].votes : 0) > 1
              ? '<p class="text-xl text-slate-400 mt-5">Clear winner by ' +
                plural(best - (top[1] ? top[1].votes : 0), 'vote') + '</p>'
              : best - (top[1] ? top[1].votes : 0) === 1
                ? '<p class="text-xl text-amber-300 mt-5">A very close result, just ' + plural(1, 'vote') + ' ahead</p>'
                : '');

    stage.innerHTML =
        '<div class="w-full max-w-5xl flex flex-col items-center gap-10">' +
        '<div class="w-full">' + headline + '</div>' +
        '<div class="w-full card p-6 flex flex-col gap-4">' + barsHtml + '</div>' +
        '<div class="flex items-center gap-3">' +
        '<button id="again" class="btn btn-ghost">Show again</button>' +
        '<button id="print" class="btn btn-ghost">Print / PDF</button>' +
        '</div></div>';

    document.getElementById('again')?.addEventListener('click', begin);
    document.getElementById('print')?.addEventListener('click', () => window.print());
}

function setPhase(phase) {
    state.phase = phase;
    if (phase === 'counting') startCounting();
    else if (phase === 'winner') {
        stopTimer();
        const p = state.poll;
        const top = ranked(p);
        if (p.totalVotes === 0) {
            dudSound();
        } else if (top.filter((r) => r.votes === top[0].votes).length === 1) {
            fanfare();
            burst(220);
            setTimeout(() => burst(160), 700);
        } else {
            fanfare();
            burst(90);
        }
        renderWinner(p);
    } else if (phase === 'idle') {
        stopTimer();
        renderIdle(state.poll);
    }
}

function startCounting() {
    stopTimer();
    const p = state.poll;
    renderCounting(p);

    const target = {};
    for (const o of p.options) target[o.id] = o.votes;
    const total = p.totalVotes;
    if (!total) {
        setPhase('winner');
        return;
    }

    const TICKS = 34;
    let tick = 0;
    state.shown = {};
    for (const id of Object.keys(target)) state.shown[id] = 0;

    const step = () => {
        tick += 1;
        for (const id of Object.keys(target)) {
            state.shown[id] = Math.round((target[id] * tick) / TICKS);
        }
        renderCounting(p);
        tickSound();
        if (tick >= TICKS) {
            for (const id of Object.keys(target)) state.shown[id] = target[id];
            renderCounting(p);
            setTimeout(() => setPhase('winner'), 450);
            return;
        }
        timer = setTimeout(step, 70);
    };
    timer = setTimeout(step, 350);
}

function stopTimer() {
    if (timer) clearTimeout(timer);
    timer = 0;
}

function begin() {
    if (!state.poll) return;
    setPhase('counting');
}

function onKey(e) {
    if (e.key === 'm' || e.key === 'M') {
        setMuted(!isMuted());
        const btn = document.getElementById('mute');
        if (btn) btn.textContent = 'Sound: ' + (isMuted() ? 'off' : 'on');
        return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (state.phase === 'idle') begin();
        else if (state.phase === 'counting') {
            setPhase('winner');
        } else if (state.phase === 'winner') begin();
    }
}

document.getElementById('mute')?.addEventListener('click', (e) => {
    setMuted(!isMuted());
    e.currentTarget.textContent = 'Sound: ' + (isMuted() ? 'off' : 'on');
});

document.addEventListener('keydown', onKey);
stage.addEventListener('click', (e) => {
    if (state.phase === 'idle') begin();
    else if (state.phase === 'counting' && !e.target.closest('button')) {
        setPhase('winner');
    }
});

function onData(poll) {
    state.poll = poll;
    if (state.phase === 'load') setPhase('idle');
}

renderLoad();
subscribePoll(POLL_ID, onData, (msg) => {
    stage.innerHTML =
        '<div class="max-w-xl text-center">' +
        '<h1 class="text-3xl font-black text-rose-300 mb-3">Cannot reach the ballot</h1>' +
        '<p class="text-slate-400">' + escapeHtml(msg) + '</p>' +
        '<p class="text-sm text-slate-600 mt-6">Check the projector laptop is online, then reload.</p>' +
        '</div>';
});
