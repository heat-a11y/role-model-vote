import { describeNetworkError, isOfflineError } from './network.js';
import {
    ensurePoll,
    subscribePoll,
    savePoll,
    setVotingOpen,
    setClassSealed,
    resetVotes,
    readLedger,
    tallyLedger,
    normaliseClassKey,
    newId,
    escapeHtml
} from './store.js';
import { icon, dot, download, toCsv, stamp, pluralise } from './ui.js';
import { burst } from './confetti.js';

const params = new URLSearchParams(location.search);
const POLL_ID = params.get('poll') || 'role-model-2026';

const BAR = [
    'from-indigo-500 to-blue-500',
    'from-violet-500 to-purple-500',
    'from-emerald-500 to-teal-500',
    'from-amber-500 to-orange-500',
    'from-rose-500 to-pink-500',
    'from-cyan-500 to-sky-500',
    'from-fuchsia-500 to-purple-500',
    'from-lime-500 to-green-500'
];

const state = {
    poll: null,
    net: 'init',
    error: '',
    audit: null,
    panel: 'results',
    announce: false
};

let view = document.getElementById('view');
let modal = document.getElementById('modal');
let auditTimer = 0;

const netPill = document.getElementById('net-pill');
const btnGate = document.getElementById('btn-gate');
const btnAnnounce = document.getElementById('btn-announce');
const toastEl = document.getElementById('toast');
const toastMsg = document.getElementById('toast-msg');

document.getElementById('hd-icon').innerHTML = icon('chart', 'w-5 h-5');
btnAnnounce.innerHTML = icon('trophy', 'w-4 h-4') + '<span>Winner</span>';

function toast(msg, ms = 2800) {
    toastMsg.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
        toastEl.style.opacity = '0';
    }, ms);
}

async function guard(fn, okMsg) {
    try {
        await fn();
        if (okMsg) toast(okMsg);
    } catch (err) {
        toast(err.message || describeNetworkError(err));
    }
}

function statCard(value, label, tone) {
    return (
        '<div class="card px-5 py-4">' +
        '<span class="stat-value ' + tone + '">' + value + '</span>' +
        '<span class="stat-label text-slate-400 mt-1">' + label + '</span>' +
        '</div>'
    );
}

function resultsPanel(p) {
    const total = p.totalVotes || 0;
    const max = Math.max(1, ...p.options.map((o) => o.votes));
    const leader = p.options.reduce((a, o) => (o.votes > (a ? a.votes : -1) ? o : a), null);
    const tie = p.options.filter((o) => o.votes === (leader ? leader.votes : -1)).length > 1;

    const bars = p.options
        .map((o, i) => {
            const share = total ? (o.votes / total) * 100 : 0;
            const width = total ? (o.votes / max) * 100 : 0;
            return (
                '<div class="card p-4 md:p-5">' +
                '<div class="flex justify-between items-center gap-3 mb-3">' +
                '<span class="font-semibold text-white text-base md:text-lg flex items-center min-w-0">' +
                '<span class="w-3 h-3 rounded-full bg-gradient-to-r ' + BAR[i % BAR.length] + ' mr-3 shrink-0"></span>' +
                '<span class="truncate">' + escapeHtml(o.text) + '</span></span>' +
                '<span class="flex items-center gap-3 shrink-0">' +
                '<span class="text-xl md:text-2xl font-extrabold text-white num">' + o.votes + '</span>' +
                '<span class="text-xs font-bold px-2 py-1 rounded-lg bg-slate-800 text-slate-300 num">' +
                share.toFixed(1) +
                '%</span>' +
                '</span></div>' +
                '<div class="bar-track"><div class="bg-gradient-to-r ' + BAR[i % BAR.length] +
                ' h-full rounded-full origin-left transition-transform duration-500" style="transform:scaleX(' +
                (width / 100).toFixed(4) + ')"></div></div></div>'
            );
        })
        .join('');

    return (
        '<div class="space-y-4">' +
        (total === 0
            ? '<div class="card p-5 text-slate-400 text-sm">' +
              icon('clock', 'w-4 h-4 inline mr-2') +
              'No votes recorded yet. Open the voting on each class laptop to begin.</div>'
            : '') +
        bars +
        (total > 0 && leader
            ? '<div class="card p-5 flex items-center gap-4">' +
              '<div class="w-12 h-12 rounded-xl bg-gradient-to-br ' + BAR[p.options.indexOf(leader) % BAR.length] +
              ' flex items-center justify-center shrink-0">' + icon('trophy', 'w-6 h-6 text-white') + '</div>' +
              '<div><div class="text-xs uppercase tracking-wider text-slate-400 font-semibold">' +
              (tie ? 'Currently tied' : 'Leading') + '</div>' +
              '<div class="text-xl font-extrabold text-white">' + escapeHtml(leader.text) + ' &mdash; ' +
              pluralise(leader.votes, 'vote') + '</div></div></div>'
            : '') +
        '</div>'
    );
}

function classesPanel(p) {
    const keys = Object.keys(p.classes);
    if (!keys.length) {
        return (
            '<div class="card p-6 text-center text-slate-400">' +
            icon('users', 'w-6 h-6 inline mb-2 opacity-60') +
            '<div class="font-semibold text-white mb-1">No classes set up yet</div>' +
            '<p class="text-sm">Add your classes with their number of pupils. The dashboard then shows how many ' +
            'have voted in each class, and warns you if a class votes more than its roll size.</p>' +
            '<button class="btn btn-primary mt-4" data-act="add-class">' + icon('plus', 'w-4 h-4') +
            '<span>Add a class</span></button></div>'
        );
    }

    const rows = keys
        .map((k) => {
            const c = p.classes[k];
            const roster = c.roster || 0;
            const sealed = p.sealed[k] === true;
            const over = roster > 0 && c.votes > roster;
            const under = !sealed && roster > 0 && c.votes < roster;
            const share = roster ? Math.min(100, (c.votes / roster) * 100) : 0;
            const tone = sealed ? 'text-emerald-300' : over ? 'text-rose-300' : under ? 'text-amber-300' : 'text-slate-300';
            return (
                '<tr class="border-t border-slate-800 ' + (sealed ? 'bg-emerald-950/20' : '') + '">' +
                '<td class="py-3 pr-3 font-semibold text-white">' + escapeHtml(k) +
                (sealed
                    ? ' <span class="pill bg-emerald-500/15 text-emerald-300 ml-1">' + icon('lock', 'w-3 h-3') +
                      '<span>sealed</span></span>'
                    : '') +
                '</td>' +
                '<td class="py-3 px-3 num text-slate-300">' + (roster || '?') + '</td>' +
                '<td class="py-3 px-3 num text-lg font-extrabold text-white">' + c.votes + '</td>' +
                '<td class="py-3 px-3 ' + tone + ' font-bold text-sm">' +
                (sealed
                    ? 'signed off'
                    : over
                      ? pluralise(c.votes - roster, 'vote') + ' over roll'
                      : under
                        ? 'still voting'
                        : 'complete') +
                '</td>' +
                '<td class="py-3 pl-3 w-40"><div class="bar-track h-2">' +
                '<div class="h-full rounded-full origin-left ' +
                (sealed ? 'bg-emerald-500' : over ? 'bg-rose-500' : under ? 'bg-amber-500' : 'bg-slate-500') +
                '" style="transform:scaleX(' + (share / 100).toFixed(4) + ')"></div></div></td>' +
                '<td class="py-3 pl-3">' +
                '<button class="btn ' + (sealed ? 'btn-ghost' : 'btn-success') + ' text-xs px-3 py-2" ' +
                'data-act="' + (sealed ? 'unseal' : 'seal') + '" data-key="' + escapeHtml(k) + '">' +
                (sealed ? icon('refresh', 'w-3.5 h-3.5') + '<span>Reopen</span>' : icon('lock', 'w-3.5 h-3.5') + '<span>Seal class</span>') +
                '</button></td>' +
                '</tr>'
            );
        })
        .join('');

    const sealedCount = keys.filter((k) => p.sealed[k] === true).length;

    const totalRoster = keys.reduce((a, k) => a + (p.classes[k].roster || 0), 0);
    const totalVotes = keys.reduce((a, k) => a + p.classes[k].votes, 0);
    const turnout = totalRoster ? Math.round((totalVotes / totalRoster) * 100) : null;
    const allDone = keys.length > 0 && sealedCount === keys.length;

    return (
        '<div class="card overflow-hidden">' +
        '<div class="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-800 flex-wrap">' +
        '<div><h3 class="font-bold text-white">Votes by class</h3>' +
        '<p class="text-xs text-slate-400 mt-0.5">' +
        (totalRoster
            ? pluralise(totalRoster, 'pupil') + ' on roll &middot; ' + turnout + '% turnout'
            : 'Add roll sizes to track turnout') +
        (sealedCount ? ' &middot; ' + sealedCount + ' of ' + keys.length + ' sealed' : '') +
        '</p></div>' +
        '<div class="flex items-center gap-2">' +
        (allDone
            ? '<button class="btn btn-success" data-act="reveal">' + icon('play', 'w-4 h-4') +
              '<span>Reveal the winner</span></button>'
            : '') +
        '<button class="btn btn-ghost" data-act="add-class" ' + (p.active ? 'disabled' : '') + '>' +
        icon('plus', 'w-4 h-4') + '<span>Add class</span></button></div></div>' +
        '<div class="overflow-x-auto"><table class="w-full text-sm">' +
        '<thead><tr class="text-left text-xs uppercase tracking-wider text-slate-500">' +
        '<th class="py-2 pr-3 font-semibold">Class</th><th class="py-2 px-3 font-semibold">Roll</th>' +
        '<th class="py-2 px-3 font-semibold">Votes</th><th class="py-2 px-3 font-semibold">Status</th>' +
        '<th class="py-2 pl-3 font-semibold">Turnout</th>' +
        '<th class="py-2 pl-3 font-semibold"><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
        rows +
        '</tbody></table></div>' +
        '<div class="px-5 py-3 border-t border-slate-800 text-xs text-slate-500">' +
        icon('lock', 'w-3.5 h-3.5 inline mr-1.5') +
        '<strong class="text-slate-400">Seal a class</strong> when it finishes voting. That closes the laptop for ' +
        'good and fixes the count as signed off, so nobody can add to it later. Check the laptop says Connected ' +
        'with no waiting badge first.' +
        '</div></div>'
    );
}

function optionsPanel(p) {
    const locked = p.active === true;
    const hasExample = p.options.some((o) => /example/i.test(o.text));

    const rows = p.options
        .map(
            (o, i) =>
                '<div class="flex items-center gap-2 py-2">' +
                '<span class="w-7 h-7 rounded-lg bg-slate-800 text-slate-400 flex items-center justify-center text-xs font-bold shrink-0 num">' +
                (i + 1) +
                '</span>' +
                '<input class="field py-2 flex-1" value="' + escapeHtml(o.text) + '" data-opt-text="' + i + '"' +
                (locked ? ' disabled' : '') +
                '>' +
                '<span class="num text-slate-400 text-sm w-16 text-right shrink-0">' + o.votes + '</span>' +
                '<button class="btn btn-ghost px-3" data-del-opt="' + i + '" ' + (locked || p.options.length <= 2 ? 'disabled' : '') +
                ' title="Remove">' + icon('trash', 'w-4 h-4') + '</button></div>'
        )
        .join('');

    return (
        '<div class="card p-5">' +
        '<div class="flex items-center justify-between gap-3 mb-3 flex-wrap">' +
        '<h3 class="font-bold text-white">Candidates</h3>' +
        (locked
            ? '<span class="pill bg-amber-500/15 text-amber-300">' + icon('lock', 'w-3.5 h-3.5') +
              '<span>Locked while voting is open</span></span>'
            : '') +
        '</div>' +
        (hasExample
            ? '<div class="p-3 rounded-xl bg-amber-950/50 border border-amber-800 text-amber-200 text-sm mb-3">' +
              icon('warn', 'w-4 h-4 inline mr-1.5') +
              'Some candidates are still the placeholder names. Replace them before you open the vote.</div>'
            : '') +
        '<div class="flex gap-2 mb-3">' +
        '<input class="field" id="new-option" placeholder="Add a candidate name" maxlength="120" ' +
        (locked ? 'disabled' : '') +
        '>' +
        '<button class="btn btn-primary shrink-0" data-act="add-option" ' + (locked ? 'disabled' : '') + '>' +
        icon('plus', 'w-4 h-4') + '</button></div>' +
        '<div class="divide-y divide-slate-800">' + rows + '</div>' +
        '</div>'
    );
}

function setupPanel(p) {
    const locked = p.active === true;
    const classes = Object.entries(p.classes);

    return (
        '<div class="space-y-4">' +
        '<div class="card p-5 space-y-4">' +
        '<div><label class="label" for="poll-title">Question on the ballot</label>' +
        '<input class="field" id="poll-title" value="' + escapeHtml(p.title) + '" maxlength="200"></div>' +
        '<div><label class="label" for="poll-sub">Sub-heading</label>' +
        '<input class="field" id="poll-sub" value="' + escapeHtml(p.subtitle) + '" maxlength="300"></div>' +
        '<div class="flex justify-end"><button class="btn btn-primary" data-act="save-text">' + icon('check', 'w-4 h-4') +
        '<span>Save text</span></button></div>' +
        '</div>' +
        optionsPanel(p) +
        '<div class="card p-5">' +
        '<div class="flex items-center justify-between gap-3 mb-3 flex-wrap">' +
        '<h3 class="font-bold text-white">Classes and roll sizes</h3>' +
        (locked
            ? '<span class="pill bg-amber-500/15 text-amber-300">' + icon('lock', 'w-3.5 h-3.5') +
              '<span>Locked while voting is open</span></span>'
            : '') +
        '</div>' +
        (classes.length
            ? classes
                  .map(
                      (c) =>
                          '<div class="flex items-center gap-2 py-2">' +
                          '<input class="field py-2 flex-1" value="' + escapeHtml(c[0]) + '" data-class-key="' +
                          escapeHtml(c[0]) + '" disabled>' +
                          '<input class="field py-2 w-28 num" type="number" min="0" max="200" value="' +
                          (c[1].roster || 0) + '" data-roster="' + escapeHtml(c[0]) + '"' +
                          (locked ? ' disabled' : '') +
                          '>' +
                          '<span class="text-xs text-slate-500 w-20 shrink-0 num">' + c[1].votes + ' voted</span>' +
                          '<button class="btn btn-ghost px-3" data-del-class="' + escapeHtml(c[0]) + '" ' +
                          (locked ? 'disabled' : '') + '>' + icon('trash', 'w-4 h-4') + '</button></div>'
                  )
                  .join('')
            : '<p class="text-sm text-slate-400">No classes yet.</p>') +
        '<div class="flex gap-2 mt-3">' +
        '<input class="field" id="new-class" placeholder="Class name (e.g. 3A)" maxlength="40" ' + (locked ? 'disabled' : '') + '>' +
        '<input class="field w-32 num" id="new-class-roll" type="number" min="0" max="200" placeholder="Roll" ' +
        (locked ? 'disabled' : '') + '>' +
        '<button class="btn btn-primary shrink-0" data-act="add-class" ' + (locked ? 'disabled' : '') + '>' +
        icon('plus', 'w-4 h-4') + '</button></div>' +
        '<p class="text-xs text-slate-500 mt-2">Class names may use letters, numbers, - and _ only. Use the same name ' +
        'on every laptop in that class.</p>' +
        '</div>' +
        '<div class="card p-5 flex flex-wrap items-center justify-between gap-3">' +
        '<div><h3 class="font-bold text-white">Start over</h3>' +
        '<p class="text-xs text-slate-400">Sets every vote and class count back to zero and closes the vote.</p></div>' +
        '<button class="btn btn-danger" data-act="reset" ' + (locked ? '' : '') + '>' + icon('refresh', 'w-4 h-4') +
        '<span>Reset all votes</span></button></div>' +
        '</div>'
    );
}

function auditPanel(p) {
    const a = state.audit;
    const body = !a
        ? '<p class="text-sm text-slate-400">' + icon('clock', 'w-4 h-4 inline mr-2') + 'Checking&hellip;</p>'
        : a.error
          ? '<div class="p-3 rounded-xl bg-rose-950/50 border border-rose-800 text-rose-200 text-sm">' +
            escapeHtml(a.error) + '</div>'
          : (() => {
                const diff = p.totalVotes - a.total;
                const ok = diff === 0;
                return (
                    '<div class="grid gap-3 sm:grid-cols-3 mb-3">' +
                    statCard(p.totalVotes, 'Counter total', 'text-indigo-300') +
                    statCard(a.total, 'Verified votes', 'text-emerald-300') +
                    statCard(diff === 0 ? 'Match' : (diff > 0 ? '+' + diff : diff), 'Difference', ok ? 'text-emerald-300' : 'text-rose-300') +
                    '</div>' +
                    (ok
                        ? '<div class="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-200 text-sm">' +
                          icon('check', 'w-4 h-4 inline mr-1.5') +
                          'Every counted vote has a matching signed record. The result is fully auditable.</div>'
                        : '<div class="p-3 rounded-xl bg-rose-950/50 border border-rose-800 text-rose-200 text-sm">' +
                          icon('warn', 'w-4 h-4 inline mr-1.5') +
                          'The counter and the signed records disagree by ' + Math.abs(diff) +
                          '. Usually this is a vote that arrived on a laptop while offline. Ask the class to tap ' +
                          'once more, or re-check the kiosk link, before announcing a result.</div>') +
                    '<div class="mt-4 overflow-x-auto"><table class="w-full text-sm">' +
                    '<thead><tr class="text-left text-xs uppercase tracking-wider text-slate-500">' +
                    '<th class="py-2 pr-3">Candidate</th><th class="py-2 px-3">Counter</th>' +
                    '<th class="py-2 px-3">Records</th><th class="py-2 pl-3">Match</th></tr></thead><tbody>' +
                    p.options
                        .map((o, i) => {
                            const rec = a.byOption[i] || 0;
                            const good = rec === o.votes;
                            return (
                                '<tr class="border-t border-slate-800"><td class="py-2 pr-3 text-white">' +
                                escapeHtml(o.text) + '</td><td class="py-2 px-3 num text-slate-300">' + o.votes +
                                '</td><td class="py-2 px-3 num text-slate-300">' + rec + '</td><td class="py-2 pl-3 ' +
                                (good ? 'text-emerald-300' : 'text-rose-300') + ' font-semibold text-sm">' +
                                (good ? 'yes' : 'differs by ' + (o.votes - rec)) + '</td></tr>'
                            );
                        })
                        .join('') +
                    '</tbody></table></div>'
                );
            })();

    return (
        '<div class="card p-5">' +
        '<div class="flex items-center justify-between gap-3 mb-3 flex-wrap">' +
        '<div><h3 class="font-bold text-white">Verification</h3>' +
        '<p class="text-xs text-slate-400">Every vote is stored as an individual signed record. These must match ' +
        'the live counter.</p></div>' +
        '<button class="btn btn-ghost" data-act="recheck">' + icon('refresh', 'w-4 h-4') + '<span>Re-check</span></button>' +
        '</div>' + body + '</div>'
    );
}

function exportPanel(p) {
    return (
        '<div class="card p-5 flex flex-wrap items-center justify-between gap-3">' +
        '<div><h3 class="font-bold text-white">Save the result</h3>' +
        '<p class="text-xs text-slate-400">Download before you announce, so you have a copy even if the network dies.</p></div>' +
        '<div class="flex flex-wrap gap-2">' +
        '<button class="btn btn-ghost" data-act="export-csv">' + icon('download', 'w-4 h-4') + '<span>Results CSV</span></button>' +
        '<button class="btn btn-ghost" data-act="export-audit">' + icon('download', 'w-4 h-4') + '<span>Every vote CSV</span></button>' +
        '<button class="btn btn-ghost" data-act="export-json">' + icon('download', 'w-4 h-4') + '<span>Full JSON</span></button>' +
        '<button class="btn btn-ghost" data-act="print">' + icon('chart', 'w-4 h-4') + '<span>Print / PDF</span></button>' +
        '</div></div>'
    );
}

function announceView(p) {
    const total = p.totalVotes || 0;
    const ranked = p.options.slice().sort((a, b) => b.votes - a.votes);
    const top = ranked[0];
    const tie = ranked.filter((o) => o.votes === (top ? top.votes : -1));
    return (
        '<div class="space-y-5">' +
        '<div class="card p-8 text-center">' +
        '<div class="text-xs uppercase tracking-widest text-indigo-400 font-bold mb-3">Result</div>' +
        '<h2 class="text-3xl md:text-5xl font-black text-white mb-3">' + escapeHtml(p.title) + '</h2>' +
        '<p class="text-slate-400">' + pluralise(total, 'vote') + ' counted' +
        (p.active ? ' &middot; voting still open' : '') +
        '</p></div>' +
        (total === 0
            ? '<div class="card p-8 text-center text-slate-400">No votes counted yet.</div>'
            : tie.length > 1
              ? '<div class="card p-8 text-center"><div class="text-xl text-amber-300 font-bold mb-4">' +
                'It is a tie between ' + tie.length + ' candidates</div><div class="space-y-3">' +
                ranked
                    .map(
                        (o) =>
                            '<div class="text-3xl font-black text-white">' + escapeHtml(o.text) + ' &mdash; ' +
                            pluralise(o.votes, 'vote') + '</div>'
                    )
                    .join('') +
                '</div></div>'
              : '<div class="card p-10 text-center bg-gradient-to-br from-indigo-900/40 to-slate-900 border-indigo-500/30">' +
                '<div class="text-xs uppercase tracking-widest text-indigo-300 font-bold mb-3">Winner</div>' +
                '<div class="text-4xl md:text-6xl font-black text-white leading-tight">' + escapeHtml(top.text) + '</div>' +
                '<div class="text-xl text-indigo-200 mt-4 num">' + pluralise(top.votes, 'vote') +
                ' &middot; ' + ((top.votes / total) * 100).toFixed(1) + '% of the vote</div></div>') +
        '<div class="card p-5">' +
        ranked
            .map((o, i) => {
                const share = total ? (o.votes / total) * 100 : 0;
                return (
                    '<div class="flex items-center gap-3 py-2">' +
                    '<span class="num text-slate-500 w-6 text-sm font-bold">' + (i + 1) + '</span>' +
                    '<span class="flex-1 text-white font-semibold truncate">' + escapeHtml(o.text) + '</span>' +
                    '<span class="num text-slate-300 w-12 text-right">' + o.votes + '</span>' +
                    '<span class="num text-slate-500 w-16 text-right text-sm">' + share.toFixed(1) + '%</span></div>'
                );
            })
            .join('') +
        '</div>' +
        '<div class="flex justify-center gap-2">' +
        '<button class="btn btn-ghost" data-act="close-announce">Back to dashboard</button>' +
        '<button class="btn btn-ghost" data-act="print">Print / PDF</button>' +
        '</div></div>'
    );
}

function setupLinkPanel() {
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    const url = base + 'kiosk.html?poll=' + encodeURIComponent(POLL_ID);
    return (
        '<div class="card p-5">' +
        '<h3 class="font-bold text-white mb-2">Open the voting laptops</h3>' +
        '<p class="text-xs text-slate-400 mb-3">On each class laptop, open this address and add the class name, e.g. ' +
        '<code class="text-slate-300">&amp;class=3A</code>. Each laptop then asks for its class once and remembers it.</p>' +
        '<div class="flex gap-2">' +
        '<input class="field font-mono text-xs" id="kiosk-url" readonly value="' + escapeHtml(url + '&amp;class=') + '">' +
        '<button class="btn btn-ghost shrink-0" data-act="copy-url">' + icon('check', 'w-4 h-4') + '</button></div>' +
        '</div>'
    );
}

function render() {
    const p = state.poll;

    netPill.innerHTML = dot(state.net) + '<span>' +
        (state.net === 'live' ? 'Connected' : state.net === 'down' ? 'Offline' : 'Starting') + '</span>';
    netPill.className =
        'pill ' +
        (state.net === 'live'
            ? 'bg-emerald-500/15 text-emerald-300'
            : state.net === 'down'
              ? 'bg-rose-500/15 text-rose-300'
              : 'bg-slate-800 text-slate-300');

    btnGate.innerHTML =
        (p && p.active ? icon('stop', 'w-4 h-4') + '<span>Close voting</span>' : icon('play', 'w-4 h-4') +
            '<span>Open voting</span>');
    btnGate.className = 'btn ' + (p && p.active ? 'btn-danger' : 'btn-success');
    btnGate.disabled = !p || state.net !== 'live';
    btnGate.title = '';
    btnAnnounce.classList.toggle('hidden', !p);

    document.getElementById('hd-sub').textContent = p ? p.title : 'Role Model Vote';

    if (!p) {
        view.innerHTML =
            '<div class="card p-8 text-center"><div class="text-6xl mb-4">...</div><p class="text-slate-400">Connecting to the master laptop&hellip;</p></div>';
        return;
    }

    if (state.announce) {
        view.innerHTML = announceView(p);
        wire();
        return;
    }

    const total = p.totalVotes || 0;
    const classKeys = Object.keys(p.classes);
    const totalRoster = classKeys.reduce((a, k) => a + (p.classes[k].roster || 0), 0);
    const turnout = totalRoster ? Math.round((total / totalRoster) * 100) + '%' : '--';
    const voting = classKeys.filter((k) => p.classes[k].votes > 0).length;
    const over = classKeys.filter((k) => p.classes[k].roster > 0 && p.classes[k].votes > p.classes[k].roster).length;

    const banner = state.error
        ? '<div class="p-4 rounded-2xl bg-rose-950/50 border border-rose-800 text-rose-200 text-sm mb-4">' +
          icon('warn', 'w-4 h-4 inline mr-2') + escapeHtml(state.error) + '</div>'
        : '';

    const gateBanner = p.active
        ? '<div class="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-800 text-emerald-200 text-sm mb-4 flex items-center gap-2">' +
          '<span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>' +
          '<span><strong>Voting is open.</strong> Pupils can vote on the class laptops now.</span></div>'
        : '<div class="p-4 rounded-2xl bg-amber-950/40 border border-amber-800 text-amber-200 text-sm mb-4 flex items-center gap-2">' +
          icon('lock', 'w-4 h-4') + '<span><strong>Voting is closed.</strong> The class laptops are waiting.</span></div>';

    const tabs = ['results', 'classes', 'setup', 'audit'].map((t) => {
        const label = { results: 'Results', classes: 'Classes', setup: 'Setup', audit: 'Verification' }[t];
        const on = state.panel === t;
        return (
            '<button class="btn ' + (on ? 'btn-primary' : 'btn-ghost') + '" data-tab="' + t + '">' + label + '</button>'
        );
    }).join('');

    const panel =
        state.panel === 'results'
            ? resultsPanel(p)
            : state.panel === 'classes'
              ? classesPanel(p)
              : state.panel === 'setup'
                  ? setupPanel(p)
                  : auditPanel(p);

    view.innerHTML =
        banner +
        '<div class="card px-5 py-3 mb-4 text-sm text-emerald-300 font-semibold">Master controls are ready. All connected screens update live.</div>' +
        gateBanner +
        '<div class="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-4">' +
        statCard(total, 'Total votes', 'text-indigo-300') +
        statCard(voting + '/' + (classKeys.length || 0), 'Classes voting', 'text-slate-100') +
        statCard(turnout, 'Turnout', 'text-slate-100') +
        statCard(over, 'Over roll', over ? 'text-rose-300' : 'text-slate-100') +
        '</div>' +
        '<div class="flex flex-wrap gap-2 mb-4">' + tabs + '</div>' +
        panel +
        (state.panel === 'audit' ? '<div class="h-4"></div>' : '') +
        (state.panel === 'results' || state.panel === 'classes'
            ? '<div class="h-4"></div>' + exportPanel(p) + '<div class="h-4"></div>' + setupLinkPanel()
            : '');

    wire();
}

function collectRosters(p) {
    const next = {};
    for (const el of view.querySelectorAll('[data-roster]')) {
        const key = el.dataset.roster;
        const cur = p.classes[key] || { roster: 0, votes: 0 };
        const v = Number(el.value);
        next[key] = { roster: Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0, votes: cur.votes || 0 };
    }
    return next;
}

function wire() {
    for (const el of view.querySelectorAll('[data-tab]')) {
        el.addEventListener('click', () => {
            state.panel = el.dataset.tab;
            render();
        });
    }
    for (const el of view.querySelectorAll('[data-act]')) {
        el.addEventListener('click', () => action(el.dataset.act, el));
    }
    for (const el of view.querySelectorAll('[data-opt-text]')) {
        el.addEventListener('change', () => {
            const p = state.poll;
            const i = Number(el.dataset.optText);
            const text = el.value.trim();
            if (!text) {
                el.value = p.options[i].text;
                return;
            }
            const options = p.options.map((o, j) => (j === i ? { ...o, text } : o));
            guard(() => savePoll(POLL_ID, { options }), 'Candidate updated');
        });
    }
    for (const el of view.querySelectorAll('[data-del-opt]')) {
        el.addEventListener('click', () => {
            const p = state.poll;
            if (p.options.length <= 2) return toast('You need at least two candidates');
            const i = Number(el.dataset.delOpt);
            const removed = p.options[i];
            const votes = removed.votes;
            const options = p.options.filter((o, j) => j !== i);
            openConfirm(
                'Remove candidate?',
                'This removes "' + removed.text + '" and its ' + pluralise(votes, 'vote') + ' from the total. Only do this before voting opens.',
                async () => {
                    await savePoll(POLL_ID, { options });
                    toast('Candidate removed');
                }
            );
        });
    }
    for (const el of view.querySelectorAll('[data-del-class]')) {
        el.addEventListener('click', () => {
            const key = el.dataset.delClass;
            const p = state.poll;
            const next = { ...p.classes };
            delete next[key];
            openConfirm(
                'Remove ' + key + '?',
                'The votes already counted from ' + key + ' (' + pluralise(p.classes[key].votes, 'vote') + ') will be removed from the result.',
                async () => {
                    await savePoll(POLL_ID, { classes: next });
                    toast('Class removed');
                }
            );
        });
    }
    const copyBtn = view.querySelector('[data-act="copy-url"]');
    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            const input = document.getElementById('kiosk-url');
            if (!input) return;
            try {
                await navigator.clipboard.writeText(input.value);
                toast('Address copied');
            } catch (e) {
                void e;
                input.select();
                toast('Press Ctrl+C to copy');
            }
        });
    }

}

function openConfirm(title, msg, onYes) {
    modal.innerHTML =
        '<div class="min-h-full flex items-center justify-center py-10">' +
        '<div class="card w-full max-w-md p-6">' +
        '<h3 class="text-xl font-extrabold text-white mb-2">' + escapeHtml(title) + '</h3>' +
        '<p class="text-slate-300 text-sm mb-6">' + escapeHtml(msg) + '</p>' +
        '<div class="flex gap-2 justify-end">' +
        '<button class="btn btn-ghost" data-m="no">Cancel</button>' +
        '<button class="btn btn-danger" data-m="yes">' + icon('check', 'w-4 h-4') + '<span>Yes, do it</span></button>' +
        '</div></div></div>';
    modal.classList.remove('hidden');
    const close = () => {
        modal.classList.add('hidden');
        modal.innerHTML = '';
    };
    modal.querySelector('[data-m="no"]').addEventListener('click', close);
    modal.querySelector('[data-m="yes"]').addEventListener('click', async () => {
        close();
        await guard(onYes);
    });
}

async function action(act, el) {
    const p = state.poll;
    if (!p) return;

    if (act === 'add-option') {
        const input = document.getElementById('new-option');
        const text = input.value.trim();
        if (!text) return toast('Type a candidate name first');
        const options = [...p.options, { id: 'opt_' + newId().slice(0, 8), text, votes: 0 }];
        input.value = '';
        await guard(() => savePoll(POLL_ID, { options }), 'Candidate added');
    }

    if (act === 'add-class') {
        const nameEl = document.getElementById('new-class');
        const rollEl = document.getElementById('new-class-roll');
        if (nameEl && rollEl) {
            const key = normaliseClassKey(nameEl.value);
            if (!key) return toast('Class name may use letters, numbers, - and _ only');
            if (p.classes[key]) return toast('That class is already on the list');
            const roll = Number(rollEl.value);
            await guard(
                () => savePoll(POLL_ID, { classes: { ...p.classes, [key]: { roster: Number.isFinite(roll) && roll >= 0 ? Math.floor(roll) : 0, votes: 0 } } }),
                'Class ' + key + ' added'
            );
            return;
        }
        state.panel = 'setup';
        render();
        document.getElementById('new-class')?.focus();
    }

    if (act === 'save-text') {
        const t = document.getElementById('poll-title').value.trim();
        const s = document.getElementById('poll-sub').value.trim();
        await guard(() => savePoll(POLL_ID, { title: t || 'Vote', subtitle: s }), 'Ballot text saved');
    }

    if (act === 'seal' || act === 'unseal') {
        const key = el.dataset.key;
        const p = state.poll;
        const sealed = act === 'seal';
        const votes = p.classes[key].votes;
        const roster = p.classes[key].roster || 0;
        const body = sealed
            ? 'The ' + key + ' count of ' + pluralise(votes, 'vote') +
              (roster && votes !== roster ? ' (roll is ' + roster + ')' : '') +
              ' is signed off and the ' + key + ' laptop stops accepting votes. This is not easily undone. ' +
              '<strong class="text-amber-300">Before you do, check the ' + key + ' laptop shows Connected with no ' +
              'amber waiting badge</strong>, otherwise a vote still waiting to sync will be thrown away.'
            : 'Reopen ' + key + ' so its laptop can vote again. Votes already counted stay counted.';
        openConfirm(sealed ? 'Seal ' + key + '?' : 'Reopen ' + key + '?', body, async () => {
            await guard(() => setClassSealed(POLL_ID, key, sealed), sealed ? key + ' sealed' : key + ' reopened');
        });
    }

    if (act === 'reveal') {
        const url = new URL('reveal.html', location.href);
        url.searchParams.set('poll', POLL_ID);
        window.open(url.toString(), '_blank', 'noopener');
    }

    if (act === 'reset') {
        openConfirm('Reset all votes?', 'Every vote from every class is cleared and voting is closed. This cannot be undone.', async () => {
            await resetVotes(POLL_ID);
            state.audit = null;
            runAudit();
            toast('All votes cleared');
        });
    }

    if (act === 'recheck') {
        state.audit = null;
        render();
        runAudit();
    }

    if (act === 'close-announce') {
        state.announce = false;
        render();
    }

    if (act === 'print') {
        window.print();
    }

    if (act === 'export-csv' || act === 'export-audit' || act === 'export-json') {
        await runAudit();
        const a = state.audit;
        if (!a || a.error || !a.rows) return toast('Could not read the vote records. Try again.');
        const name = POLL_ID + '_' + stamp();

        if (act === 'export-csv') {
            const rows = [['Candidate', 'Votes', 'Percent']];
            for (const o of p.options) {
                rows.push([o.text, o.votes, p.totalVotes ? ((o.votes / p.totalVotes) * 100).toFixed(2) : '0.00']);
            }
            rows.push([]);
            rows.push(['TOTAL', p.totalVotes, '100.00']);
            rows.push([]);
            rows.push(['Class', 'Roll', 'Votes', 'Status']);
            for (const [k, c] of Object.entries(p.classes)) {
                rows.push([k, c.roster, c.votes, c.roster && c.votes > c.roster ? 'over roll' : '']);
            }
            download(name + '_results.csv', toCsv(rows));
            toast('Results saved');
        }

        if (act === 'export-audit') {
            const rows = [['Record', 'Class', 'Candidate', 'Recorded at']];
            const sorted = a.rows.slice().sort((x, y) => String(x.at || '').localeCompare(String(y.at || '')));
            for (const r of sorted) {
                const when = r.at && typeof r.at.toDate ? r.at.toDate().toISOString() : String(r.at || '');
                rows.push([r.id, r.classKey, r.optionText || r.optionId, when]);
            }
            download(name + '_every-vote.csv', toCsv(rows));
            toast(pluralise(a.rows.length, 'record') + ' saved');
        }

        if (act === 'export-json') {
            download(
                name + '_full.json',
                JSON.stringify(
                    {
                        pollId: POLL_ID,
                        exportedAt: new Date().toISOString(),
                        question: p.title,
                        totalVotes: p.totalVotes,
                        votingOpen: p.active,
                        results: p.options.map((o) => ({
                            id: o.id,
                            name: o.text,
                            votes: o.votes,
                            percent: p.totalVotes ? Number(((o.votes / p.totalVotes) * 100).toFixed(2)) : 0
                        })),
                        classes: p.classes,
                        verification: {
                            counterTotal: p.totalVotes,
                            recordTotal: a.total,
                            match: p.totalVotes === a.total
                        }
                    },
                    null,
                    2
                ),
                'application/json'
            );
            toast('Full result saved');
        }
    }
}

async function runAudit() {
    try {
        const rows = await readLedger(POLL_ID);
        const t = tallyLedger(rows, state.poll ? state.poll.options : []);
        state.audit = { ...t, rows };
    } catch (err) {
        state.audit = { error: err.message || describeNetworkError(err) };
    }
    if (state.panel === 'audit') render();
}

function onPollData(poll) {
    const first = state.poll === null;
    const wasOpen = state.poll ? state.poll.active : null;
    state.poll = poll;
    state.net = 'live';
    state.error = '';
    if (first) {
        state.announce = false;
        runAudit();
    }
    if (wasOpen === false && poll.active === true) {
        burst(40);
        toast('Voting is now open on the class laptops');
    }
    render();
}

function onPollError(err) {
    if (isOfflineError(err)) {
        state.net = 'down';
        state.error = 'Lost the connection to the master laptop. Results shown may be out of date. The class laptops are holding votes and will sync automatically.';
    } else {
        state.error = describeNetworkError(err);
    }
    render();
}

async function boot() {
    try {
        await ensurePoll(POLL_ID);
        state.net = 'live';
        subscribePoll(POLL_ID, onPollData, onPollError);
        runAudit();
        auditTimer = setInterval(() => {
            if (document.visibilityState === 'visible') runAudit();
        }, 20000);
    } catch (err) {
        state.error = isOfflineError(err)
            ? 'Cannot reach the master laptop. Check that it is running and this device is on the same Wi-Fi.'
            : describeNetworkError(err);
        render();
    }
}

btnGate.addEventListener('click', async () => {
    const p = state.poll;
    if (!p) return;
    const next = !p.active;
    if (!next && p.active) {
        openConfirm('Close voting?', 'Pupils will see "Voting is closed" on their laptops. You can reopen at any time.', async () => {
            await guard(() => setVotingOpen(POLL_ID, false), 'Voting closed');
        });
        return;
    }
    const unedited = p.options.some((o) => /example/i.test(o.text));
    if (unedited) return toast('Replace the placeholder candidate names first (Setup tab)');
    if (!Object.keys(p.classes).length) return toast('Add your classes first (Setup tab), otherwise votes are rejected');
    await guard(() => setVotingOpen(POLL_ID, true), 'Voting is open');
});

btnAnnounce.addEventListener('click', () => {
    state.announce = true;
    render();
});

modal.addEventListener('click', (e) => {
    if (e.target === modal) {
        modal.classList.add('hidden');
        modal.innerHTML = '';
    }
});

render();
boot();
