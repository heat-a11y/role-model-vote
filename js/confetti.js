let canvas = null;
let ctx = null;
let raf = 0;
let particles = [];

const COLORS = ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#06b6d4', '#ffffff'];

function ensureCanvas() {
    if (canvas && canvas.isConnected) return true;
    canvas = document.createElement('canvas');
    canvas.style.cssText =
        'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    return true;
}

function resize() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function tick() {
    raf = 0;
    if (!ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
        p.vy += 0.12;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 1;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 40));
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
    }
    if (particles.length) {
        raf = requestAnimationFrame(tick);
    } else {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        if (canvas && canvas.isConnected) canvas.remove();
        canvas = null;
        ctx = null;
    }
}

export function burst(count = 90) {
    if (typeof requestAnimationFrame !== 'function') return;
    if (!ensureCanvas()) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = 0; i < count; i += 1) {
        particles.push({
            x: w / 2 + (Math.random() - 0.5) * w * 0.7,
            y: h * 0.45 + (Math.random() - 0.5) * 40,
            vx: (Math.random() - 0.5) * 9,
            vy: -6 - Math.random() * 7,
            w: 5 + Math.random() * 6,
            h: 8 + Math.random() * 8,
            rot: Math.random() * Math.PI,
            vr: (Math.random() - 0.5) * 0.3,
            life: 70 + Math.random() * 50,
            color: COLORS[Math.floor(Math.random() * COLORS.length)]
        });
    }
    if (!raf) raf = requestAnimationFrame(tick);
}

if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
        if (canvas) resize();
    });
}
