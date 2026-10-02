const PATHS = {
    chart: 'M3 3v18h18M7 15l4-5 3 3 5-7',
    check: 'M20 6L9 17l-5-5',
    lock: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4',
    play: 'M6 4l14 8-14 8z',
    stop: 'M6 6h12v12H6z',
    plus: 'M12 5v14M5 12h14',
    trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
    pencil: 'M4 20h4L20 8l-4-4L4 16z',
    download: 'M12 3v12M7 11l5 5 5-5M4 21h16',
    refresh: 'M4 12a8 8 0 1116 0M4 12a8 8 0 008 8M4 4v5h5',
    warn: 'M12 3l10 18H2zM12 10v5M12 18v.5',
    wifi: 'M2 8a16 16 0 0120 0M5 12a11 11 0 0114 0M8.5 15.5a6 6 0 017 0M12 19v.5',
    users: 'M16 20v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 10a4 4 0 100-8 4 4 0 000 8M22 20v-2a4 4 0 00-3-3.9',
    trophy: 'M8 4h8v5a4 4 0 01-8 0zM8 6H5v1a3 3 0 003 3M16 6h3v1a3 3 0 01-3 3M10 13v3M14 13v3M8 20h8M10 16h4v4',
    clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
    back: 'M15 18l-6-6 6-6'
};

export function icon(name, cls = 'w-5 h-5') {
    const d = PATHS[name] || PATHS.check;
    return (
        '<svg class="' +
        cls +
        '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="' +
        d +
        '"></path></svg>'
    );
}

export function dot(state) {
    const map = {
        live: 'bg-emerald-400',
        pending: 'bg-amber-400',
        down: 'bg-rose-500',
        init: 'bg-slate-500'
    };
    return '<span class="inline-block w-2.5 h-2.5 rounded-full ' + (map[state] || map.init) + '"></span>';
}

export function pct(part, whole) {
    if (!whole) return 0;
    return (part / whole) * 100;
}

export function pluralise(n, one, many) {
    return n + ' ' + (n === 1 ? one : many || one + 's');
}

export function download(filename, text, mime = 'text/csv;charset=utf-8') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function toCsv(rows) {
    return rows
        .map((row) =>
            row
                .map((cell) => {
                    const s = cell == null ? '' : String(cell);
                    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
                })
                .join(',')
        )
        .join('\n');
}

export function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return (
        d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' +
        p(d.getHours()) + '-' + p(d.getMinutes())
    );
}
