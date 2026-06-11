// Traditional random walk generator and visualization.
//
// A seeded, unbiased 2D lattice walk: every step moves north, east, south, or
// west with probability 0.25. The module is self-contained, responsive, and
// pauses animation work when the panel is not visible.

(function () {
    'use strict';

    const canvas = document.getElementById('random-walk-canvas');
    if (!canvas) return;

    const frame = canvas.parentElement;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const ui = {
        toggle: document.getElementById('rw-toggle'),
        step: document.getElementById('rw-step'),
        reset: document.getElementById('rw-reset'),
        reroll: document.getElementById('rw-reroll'),
        walkers: document.getElementById('rw-walkers'),
        walkersValue: document.getElementById('rw-walkers-value'),
        speed: document.getElementById('rw-speed'),
        speedValue: document.getElementById('rw-speed-value'),
        seed: document.getElementById('rw-seed'),
        status: document.getElementById('rw-status'),
        live: document.querySelector('.random-walk-live'),
        steps: document.getElementById('rw-steps'),
        mean: document.getElementById('rw-mean'),
        rms: document.getElementById('rw-rms'),
        expected: document.getElementById('rw-expected')
    };

    const reduceMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const COLORS = [
        [120, 240, 255],
        [255, 138, 43],
        [255, 46, 68],
        [255, 45, 166],
        [247, 238, 240],
        [151, 255, 174]
    ];

    let W = 0, H = 0, dpr = 1;
    let rng = makeRng('daly-2026');
    let walkers = [];
    let stepCount = 0;
    let running = !reduceMotion;
    let visible = !document.hidden;
    let rafId = 0;

    function clamp(v, lo, hi) {
        return v < lo ? lo : v > hi ? hi : v;
    }

    function num(el, fallback) {
        const value = parseInt(el && el.value, 10);
        return Number.isFinite(value) ? value : fallback;
    }

    function fmt(value) {
        if (value >= 1000) return Math.round(value).toString();
        if (value >= 100) return value.toFixed(1);
        return value.toFixed(2);
    }

    function hashSeed(text) {
        let h = 2166136261;
        const input = String(text || 'random-walk');
        for (let i = 0; i < input.length; i++) {
            h ^= input.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0 || 1;
    }

    function makeRng(seedText) {
        let a = hashSeed(seedText);
        return function () {
            a += 0x6D2B79F5;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function walkerLimit() {
        return Math.max(700, Math.floor(42000 / Math.max(1, walkers.length)));
    }

    function compactPath(walker) {
        const limit = walkerLimit();
        if (walker.path.length <= limit) return;

        const path = walker.path;
        const compact = [path[0]];
        const offset = path.length % 2 ? 1 : 2;
        for (let i = offset; i < path.length - 1; i += 2) compact.push(path[i]);
        compact.push(path[path.length - 1]);
        walker.path = compact;
    }

    function resetWalkers() {
        const count = clamp(num(ui.walkers, 12), 1, 64);
        walkers = [];
        for (let i = 0; i < count; i++) {
            walkers.push({
                x: 0,
                y: 0,
                path: [{ x: 0, y: 0 }],
                color: COLORS[i % COLORS.length]
            });
        }
    }

    function reset() {
        rng = makeRng(ui.seed && ui.seed.value);
        stepCount = 0;
        resetWalkers();
        updateReadouts();
        render();
        if (running && visible) startLoop();
    }

    function advance(steps) {
        for (let s = 0; s < steps; s++) {
            for (const walker of walkers) {
                const r = rng();
                if (r < 0.25) walker.y += 1;
                else if (r < 0.5) walker.x += 1;
                else if (r < 0.75) walker.y -= 1;
                else walker.x -= 1;

                walker.path.push({ x: walker.x, y: walker.y });
                compactPath(walker);
            }
            stepCount++;
        }
    }

    function measureExtent() {
        let extent = Math.max(16, Math.sqrt(Math.max(1, stepCount)) * 3.1);
        for (const walker of walkers) {
            extent = Math.max(extent, Math.abs(walker.x), Math.abs(walker.y));
            const path = walker.path;
            const stride = Math.max(1, Math.floor(path.length / 600));
            for (let i = 0; i < path.length; i += stride) {
                const p = path[i];
                extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
            }
        }
        return extent * 1.12;
    }

    function niceStep(raw) {
        if (!Number.isFinite(raw) || raw <= 0) return 1;
        const pow = Math.pow(10, Math.floor(Math.log10(raw)));
        const f = raw / pow;
        if (f <= 1) return pow;
        if (f <= 2) return 2 * pow;
        if (f <= 5) return 5 * pow;
        return 10 * pow;
    }

    function rgba(rgb, alpha) {
        return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')';
    }

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        const r = frame.getBoundingClientRect();
        W = Math.max(1, Math.round(r.width));
        H = Math.max(1, Math.round(r.height));
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        render();
    }

    function drawBackground() {
        ctx.globalCompositeOperation = 'source-over';
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#070912');
        bg.addColorStop(0.56, '#05060a');
        bg.addColorStop(1, '#030407');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        const glow = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.58);
        glow.addColorStop(0, 'rgba(120,240,255,0.075)');
        glow.addColorStop(0.48, 'rgba(255,46,68,0.035)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
    }

    function drawGrid(cx, cy, scale, extent) {
        const gridStep = niceStep(46 / scale);
        const min = -Math.ceil(extent / gridStep) * gridStep;
        const max = Math.ceil(extent / gridStep) * gridStep;

        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(120,240,255,0.075)';
        ctx.beginPath();
        for (let x = min; x <= max; x += gridStep) {
            const px = cx + x * scale;
            ctx.moveTo(px, 0);
            ctx.lineTo(px, H);
        }
        for (let y = min; y <= max; y += gridStep) {
            const py = cy - y * scale;
            ctx.moveTo(0, py);
            ctx.lineTo(W, py);
        }
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255,46,68,0.22)';
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, H);
        ctx.moveTo(0, cy);
        ctx.lineTo(W, cy);
        ctx.stroke();
    }

    function drawExpectedRadius(cx, cy, scale) {
        if (!stepCount) return;
        const radius = Math.sqrt(stepCount) * scale;
        if (radius < 4 || radius > Math.max(W, H) * 1.6) return;

        ctx.globalCompositeOperation = 'source-over';
        ctx.save();
        ctx.setLineDash([7, 9]);
        ctx.strokeStyle = 'rgba(255,138,43,0.46)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    function drawPaths(cx, cy, scale) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const baseAlpha = walkers.length > 24 ? 0.34 : 0.56;
        for (let i = 0; i < walkers.length; i++) {
            const walker = walkers[i];
            const path = walker.path;
            const stride = Math.max(1, Math.floor(path.length / 1500));
            const rgb = walker.color;

            ctx.strokeStyle = rgba(rgb, i === 0 ? Math.min(0.86, baseAlpha + 0.22) : baseAlpha);
            ctx.lineWidth = i === 0 && walkers.length <= 12 ? 1.75 : 1.1;
            ctx.beginPath();
            ctx.moveTo(cx + path[0].x * scale, cy - path[0].y * scale);
            for (let p = stride; p < path.length; p += stride) {
                ctx.lineTo(cx + path[p].x * scale, cy - path[p].y * scale);
            }
            const last = path[path.length - 1];
            ctx.lineTo(cx + last.x * scale, cy - last.y * scale);
            ctx.stroke();

            const size = i === 0 && walkers.length <= 12 ? 5 : 3.4;
            ctx.fillStyle = rgba(rgb, 0.92);
            ctx.fillRect(cx + walker.x * scale - size / 2, cy - walker.y * scale - size / 2, size, size);
        }
    }

    function drawOrigin(cx, cy) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(247,238,240,0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 9, cy);
        ctx.lineTo(cx + 9, cy);
        ctx.moveTo(cx, cy - 9);
        ctx.lineTo(cx, cy + 9);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,46,68,0.9)';
        ctx.fillRect(cx - 2, cy - 2, 4, 4);
    }

    function drawVignette() {
        ctx.globalCompositeOperation = 'source-over';
        const g = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.28, W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
        g.addColorStop(0, 'rgba(3,4,7,0)');
        g.addColorStop(1, 'rgba(3,4,7,0.68)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    }

    function render() {
        if (!W || !H) return;
        const pad = W < 620 ? 24 : 34;
        const extent = measureExtent();
        const scale = Math.min((W - pad * 2) / (extent * 2), (H - pad * 2) / (extent * 2));
        const cx = W * 0.5;
        const cy = H * 0.5;

        drawBackground();
        drawGrid(cx, cy, scale, extent);
        drawExpectedRadius(cx, cy, scale);
        drawPaths(cx, cy, scale);
        drawOrigin(cx, cy);
        drawVignette();
    }

    function updateReadouts() {
        if (ui.walkersValue) ui.walkersValue.textContent = String(clamp(num(ui.walkers, 12), 1, 64));
        if (ui.speedValue) ui.speedValue.textContent = String(clamp(num(ui.speed, 12), 1, 36));

        let sum = 0;
        let sumSq = 0;
        for (const walker of walkers) {
            const r2 = walker.x * walker.x + walker.y * walker.y;
            sum += Math.sqrt(r2);
            sumSq += r2;
        }
        const count = Math.max(1, walkers.length);
        if (ui.steps) ui.steps.textContent = String(stepCount);
        if (ui.mean) ui.mean.textContent = fmt(sum / count);
        if (ui.rms) ui.rms.textContent = fmt(Math.sqrt(sumSq / count));
        if (ui.expected) ui.expected.textContent = fmt(Math.sqrt(stepCount));
        if (ui.status) ui.status.textContent = running ? 'Running' : 'Idle';
        if (ui.toggle) ui.toggle.textContent = running ? 'Pause' : 'Start';
        if (ui.live) ui.live.classList.toggle('is-running', running && visible);
    }

    function tick() {
        if (!(running && visible)) {
            rafId = 0;
            updateReadouts();
            return;
        }
        advance(clamp(num(ui.speed, 12), 1, 36));
        render();
        updateReadouts();
        rafId = requestAnimationFrame(tick);
    }

    function startLoop() {
        if (rafId) return;
        rafId = requestAnimationFrame(tick);
    }

    function stopLoop() {
        if (!rafId) return;
        cancelAnimationFrame(rafId);
        rafId = 0;
    }

    if (ui.toggle) {
        ui.toggle.addEventListener('click', () => {
            running = !running;
            updateReadouts();
            if (running && visible) startLoop();
            else stopLoop();
        });
    }

    if (ui.step) {
        ui.step.addEventListener('click', () => {
            running = false;
            stopLoop();
            advance(1);
            render();
            updateReadouts();
        });
    }

    if (ui.reset) ui.reset.addEventListener('click', reset);

    if (ui.reroll) {
        ui.reroll.addEventListener('click', () => {
            if (ui.seed) ui.seed.value = Date.now().toString(36).slice(-8);
            reset();
        });
    }

    if (ui.walkers) {
        ui.walkers.addEventListener('input', () => {
            updateReadouts();
        });
        ui.walkers.addEventListener('change', reset);
    }

    if (ui.speed) ui.speed.addEventListener('input', updateReadouts);

    if (ui.seed) {
        ui.seed.addEventListener('change', reset);
        ui.seed.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                reset();
            }
        });
    }

    document.addEventListener('visibilitychange', () => {
        visible = !document.hidden;
        if (visible && running) startLoop();
        else stopLoop();
        updateReadouts();
    });

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            visible = entries.some(entry => entry.isIntersecting) && !document.hidden;
            if (visible && running) startLoop();
            else stopLoop();
            updateReadouts();
        }, { threshold: 0, rootMargin: '100px' });
        observer.observe(frame);
    }

    if ('ResizeObserver' in window) {
        const ro = new ResizeObserver(resize);
        ro.observe(frame);
    } else {
        window.addEventListener('resize', resize);
    }

    reset();
    resize();
    updateReadouts();
    if (running && visible) startLoop();
})();
