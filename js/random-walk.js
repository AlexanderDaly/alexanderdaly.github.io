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
    const projectPanel = canvas.closest('[data-project-panel]');
    let projectActive = !projectPanel || !projectPanel.hidden;

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
    let running = false;
    let visible = projectActive && !document.hidden;
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
        visible = projectActive && !document.hidden;
        if (visible && running) startLoop();
        else stopLoop();
        updateReadouts();
    });

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            visible = projectActive && entries.some(entry => entry.isIntersecting) && !document.hidden;
            if (visible && running) startLoop();
            else stopLoop();
            updateReadouts();
        }, { threshold: 0, rootMargin: '100px' });
        observer.observe(frame);
    }

    if (projectPanel) {
        projectPanel.addEventListener('project-panel-change', (event) => {
            projectActive = !!event.detail.active;
            visible = projectActive && !document.hidden;
            if (!projectActive) {
                running = false;
                stopLoop();
            } else {
                resize();
                if (running && visible) startLoop();
            }
            updateReadouts();
        });
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

// Right-biased vector walk subproject.
//
// Each step is a vector sum: a steady rightward drift plus an isotropic random
// noise vector. The result is a continuous version of the right-biased walker.

(function () {
    'use strict';

    const canvas = document.getElementById('vector-walk-canvas');
    if (!canvas) return;

    const frame = canvas.parentElement;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    const projectPanel = canvas.closest('[data-project-panel]');
    let projectActive = !projectPanel || !projectPanel.hidden;

    const ui = {
        toggle: document.getElementById('vw-toggle'),
        step: document.getElementById('vw-step'),
        reset: document.getElementById('vw-reset'),
        reroll: document.getElementById('vw-reroll'),
        drift: document.getElementById('vw-drift'),
        driftValue: document.getElementById('vw-drift-value'),
        noise: document.getElementById('vw-noise'),
        noiseValue: document.getElementById('vw-noise-value'),
        speed: document.getElementById('vw-speed'),
        speedValue: document.getElementById('vw-speed-value'),
        seed: document.getElementById('vw-seed'),
        status: document.getElementById('vw-status'),
        live: document.querySelector('.vector-walk-live'),
        equation: document.getElementById('vw-equation'),
        steps: document.getElementById('vw-steps'),
        x: document.getElementById('vw-x'),
        y: document.getElementById('vw-y'),
        resultant: document.getElementById('vw-resultant'),
        lastVector: document.getElementById('vw-last-vector'),
        heading: document.getElementById('vw-heading')
    };

    let W = 0, H = 0, dpr = 1;
    let rng = makeRng('vector-drift');
    let point = { x: 0, y: 0 };
    let path = [{ x: 0, y: 0 }];
    let lastStep = { x: 0, y: 0 };
    let lastNoise = { x: 0, y: 0 };
    let stepCount = 0;
    let running = false;
    let visible = projectActive && !document.hidden;
    let rafId = 0;

    function clamp(v, lo, hi) {
        return v < lo ? lo : v > hi ? hi : v;
    }

    function num(el, fallback) {
        const value = parseInt(el && el.value, 10);
        return Number.isFinite(value) ? value : fallback;
    }

    function fmt(value) {
        const abs = Math.abs(value);
        if (abs >= 1000) return Math.round(value).toString();
        if (abs >= 100) return value.toFixed(1);
        return value.toFixed(2);
    }

    function fmtUnit(value) {
        return value.toFixed(2);
    }

    function hashSeed(text) {
        let h = 2166136261;
        const input = String(text || 'vector-biased-walk');
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

    function driftStrength() {
        return clamp(num(ui.drift, 36), 0, 90) / 100;
    }

    function noiseStrength() {
        return clamp(num(ui.noise, 74), 10, 120) / 100;
    }

    function resetWalker() {
        point = { x: 0, y: 0 };
        path = [{ x: 0, y: 0 }];
        lastStep = { x: 0, y: 0 };
        lastNoise = { x: 0, y: 0 };
    }

    function compactPath() {
        const limit = 11000;
        if (path.length <= limit) return;

        const compact = [path[0]];
        const offset = path.length % 2 ? 1 : 2;
        for (let i = offset; i < path.length - 1; i += 2) compact.push(path[i]);
        compact.push(path[path.length - 1]);
        path = compact;
    }

    function reset() {
        rng = makeRng(ui.seed && ui.seed.value);
        stepCount = 0;
        resetWalker();
        updateReadouts();
        render();
        if (running && visible) startLoop();
    }

    function sampleStep() {
        const drift = driftStrength();
        const noise = noiseStrength();
        const angle = rng() * Math.PI * 2;
        const radius = noise * Math.sqrt(rng());
        lastNoise = {
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius
        };
        lastStep = {
            x: drift + lastNoise.x,
            y: lastNoise.y
        };
        return lastStep;
    }

    function advance(steps) {
        for (let i = 0; i < steps; i++) {
            const v = sampleStep();
            point.x += v.x;
            point.y += v.y;
            path.push({ x: point.x, y: point.y });
            compactPath();
            stepCount++;
        }
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

    function measureBounds() {
        const drift = driftStrength() * stepCount;
        const spread = noiseStrength() * Math.sqrt(Math.max(1, stepCount)) * 2.8;
        let minX = Math.min(-10, drift - spread);
        let maxX = Math.max(18, drift + spread);
        let minY = Math.min(-14, -spread);
        let maxY = Math.max(14, spread);
        const stride = Math.max(1, Math.floor(path.length / 900));

        for (let i = 0; i < path.length; i += stride) {
            const p = path[i];
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }

        minX = Math.min(minX, point.x, 0);
        maxX = Math.max(maxX, point.x, 0);
        minY = Math.min(minY, point.y, 0);
        maxY = Math.max(maxY, point.y, 0);

        return { minX, maxX, minY, maxY };
    }

    function viewTransform() {
        const pad = W < 620 ? 24 : 34;
        const bounds = measureBounds();
        const width = Math.max(1, bounds.maxX - bounds.minX);
        const height = Math.max(1, bounds.maxY - bounds.minY);
        const plotW = Math.max(1, W - pad * 2);
        const plotH = Math.max(1, H - pad * 2);
        const scale = Math.min(plotW / width, plotH / height);
        const extraX = plotW - width * scale;
        const extraY = plotH - height * scale;
        const cx = pad + extraX / 2 - bounds.minX * scale;
        const cy = pad + extraY / 2 + bounds.maxY * scale;
        return { cx, cy, scale, bounds };
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
        const bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, '#05060d');
        bg.addColorStop(0.55, '#06070c');
        bg.addColorStop(1, '#030407');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        const glow = ctx.createRadialGradient(W * 0.42, H * 0.46, 0, W * 0.42, H * 0.46, Math.max(W, H) * 0.58);
        glow.addColorStop(0, 'rgba(120,240,255,0.08)');
        glow.addColorStop(0.46, 'rgba(255,45,166,0.045)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
    }

    function drawGrid(cx, cy, scale, bounds) {
        const gridStep = niceStep(44 / scale);
        const minX = Math.floor(bounds.minX / gridStep) * gridStep;
        const maxX = Math.ceil(bounds.maxX / gridStep) * gridStep;
        const minY = Math.floor(bounds.minY / gridStep) * gridStep;
        const maxY = Math.ceil(bounds.maxY / gridStep) * gridStep;

        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(120,240,255,0.065)';
        ctx.beginPath();
        for (let x = minX; x <= maxX; x += gridStep) {
            const px = cx + x * scale;
            ctx.moveTo(px, 0);
            ctx.lineTo(px, H);
        }
        for (let y = minY; y <= maxY; y += gridStep) {
            const py = cy - y * scale;
            ctx.moveTo(0, py);
            ctx.lineTo(W, py);
        }
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255,45,166,0.24)';
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, H);
        ctx.moveTo(0, cy);
        ctx.lineTo(W, cy);
        ctx.stroke();
    }

    function drawArrow(x0, y0, x1, y1, color, width) {
        const angle = Math.atan2(y1 - y0, x1 - x0);
        const head = Math.max(7, width * 4.5);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - Math.cos(angle - 0.55) * head, y1 - Math.sin(angle - 0.55) * head);
        ctx.lineTo(x1 - Math.cos(angle + 0.55) * head, y1 - Math.sin(angle + 0.55) * head);
        ctx.closePath();
        ctx.fill();
    }

    function drawExpectedDrift(cx, cy, scale) {
        if (!stepCount) return;
        const expectedX = driftStrength() * stepCount;
        const ex = cx + expectedX * scale;

        ctx.globalCompositeOperation = 'source-over';
        ctx.save();
        ctx.setLineDash([7, 9]);
        ctx.strokeStyle = 'rgba(255,45,166,0.38)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, cy);
        ctx.stroke();
        ctx.restore();
    }

    function drawPath(cx, cy, scale) {
        const stride = Math.max(1, Math.floor(path.length / 1800));
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(120,240,255,0.68)';
        ctx.lineWidth = 1.55;
        ctx.beginPath();
        ctx.moveTo(cx + path[0].x * scale, cy - path[0].y * scale);
        for (let i = stride; i < path.length; i += stride) {
            ctx.lineTo(cx + path[i].x * scale, cy - path[i].y * scale);
        }
        const last = path[path.length - 1];
        ctx.lineTo(cx + last.x * scale, cy - last.y * scale);
        ctx.stroke();

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(255,45,166,0.94)';
        const size = 5;
        ctx.fillRect(cx + point.x * scale - size / 2, cy - point.y * scale - size / 2, size, size);
    }

    function drawVectorDecomposition(cx, cy, scale) {
        const px = cx + point.x * scale;
        const py = cy - point.y * scale;
        const arrowScale = clamp(scale, 14, 38);
        const drift = { x: driftStrength(), y: 0 };
        const driftEnd = { x: px + drift.x * arrowScale, y: py };
        const noiseEnd = {
            x: driftEnd.x + lastNoise.x * arrowScale,
            y: driftEnd.y - lastNoise.y * arrowScale
        };

        if (!stepCount) {
            drawArrow(px, py, px + Math.max(18, drift.x * arrowScale), py, 'rgba(255,45,166,0.72)', 1.4);
            return;
        }

        ctx.globalCompositeOperation = 'source-over';
        drawArrow(px, py, driftEnd.x, driftEnd.y, 'rgba(255,45,166,0.72)', 1.4);
        drawArrow(driftEnd.x, driftEnd.y, noiseEnd.x, noiseEnd.y, 'rgba(120,240,255,0.72)', 1.2);
        drawArrow(px, py, px + lastStep.x * arrowScale, py - lastStep.y * arrowScale, 'rgba(247,238,240,0.74)', 1.6);
    }

    function drawVectorInset() {
        const x = W - 116;
        const y = H - 86;
        const r = 36;
        const drift = driftStrength();
        const noise = noiseStrength();
        const driftPx = clamp(drift / 0.9, 0, 1) * r;
        const noiseR = clamp(noise / 1.2, 0, 1) * r;

        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(120,240,255,0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, noiseR, 0, Math.PI * 2);
        ctx.stroke();
        drawArrow(x, y, x + driftPx, y, 'rgba(255,45,166,0.62)', 1.2);
        ctx.fillStyle = 'rgba(247,238,240,0.46)';
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText('noise disk', x - 30, y + r + 17);
    }

    function drawOrigin(cx, cy) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(247,238,240,0.76)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 9, cy);
        ctx.lineTo(cx + 9, cy);
        ctx.moveTo(cx, cy - 9);
        ctx.lineTo(cx, cy + 9);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,45,166,0.9)';
        ctx.fillRect(cx - 2, cy - 2, 4, 4);
    }

    function drawVignette() {
        ctx.globalCompositeOperation = 'source-over';
        const g = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.24, W * 0.5, H * 0.5, Math.max(W, H) * 0.76);
        g.addColorStop(0, 'rgba(3,4,7,0)');
        g.addColorStop(1, 'rgba(3,4,7,0.66)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    }

    function render() {
        if (!W || !H) return;
        const view = viewTransform();

        drawBackground();
        drawGrid(view.cx, view.cy, view.scale, view.bounds);
        drawExpectedDrift(view.cx, view.cy, view.scale);
        drawPath(view.cx, view.cy, view.scale);
        drawOrigin(view.cx, view.cy);
        drawVectorDecomposition(view.cx, view.cy, view.scale);
        drawVectorInset();
        drawVignette();
    }

    function updateReadouts() {
        const drift = driftStrength();
        const noise = noiseStrength();
        const mag = Math.hypot(point.x, point.y);
        const heading = stepCount ? Math.atan2(point.y, point.x) * 180 / Math.PI : 0;
        if (ui.driftValue) ui.driftValue.textContent = fmtUnit(drift);
        if (ui.noiseValue) ui.noiseValue.textContent = fmtUnit(noise);
        if (ui.speedValue) ui.speedValue.textContent = String(clamp(num(ui.speed, 8), 1, 28));
        if (ui.equation) ui.equation.textContent = 'step = (' + fmtUnit(drift) + ', 0) + random vector';
        if (ui.steps) ui.steps.textContent = String(stepCount);
        if (ui.x) ui.x.textContent = fmt(point.x);
        if (ui.y) ui.y.textContent = fmt(point.y);
        if (ui.resultant) ui.resultant.textContent = fmt(mag);
        if (ui.lastVector) ui.lastVector.textContent = fmt(lastStep.x) + ', ' + fmt(lastStep.y);
        if (ui.heading) ui.heading.textContent = Math.round(heading) + ' deg';
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
        advance(clamp(num(ui.speed, 8), 1, 28));
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

    if (ui.drift) ui.drift.addEventListener('input', reset);
    if (ui.noise) ui.noise.addEventListener('input', reset);
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
        visible = projectActive && !document.hidden;
        if (visible && running) startLoop();
        else stopLoop();
        updateReadouts();
    });

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            visible = projectActive && entries.some(entry => entry.isIntersecting) && !document.hidden;
            if (visible && running) startLoop();
            else stopLoop();
            updateReadouts();
        }, { threshold: 0, rootMargin: '100px' });
        observer.observe(frame);
    }

    if (projectPanel) {
        projectPanel.addEventListener('project-panel-change', (event) => {
            projectActive = !!event.detail.active;
            visible = projectActive && !document.hidden;
            if (!projectActive) {
                running = false;
                stopLoop();
            } else {
                resize();
                if (running && visible) startLoop();
            }
            updateReadouts();
        });
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

// Right-biased random walk subproject.
//
// A single seeded lattice walker where the eastward step receives probability
// p, and north/south/west split the remaining probability equally.

(function () {
    'use strict';

    const canvas = document.getElementById('biased-walk-canvas');
    if (!canvas) return;

    const frame = canvas.parentElement;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    const projectPanel = canvas.closest('[data-project-panel]');
    let projectActive = !projectPanel || !projectPanel.hidden;

    const ui = {
        toggle: document.getElementById('bw-toggle'),
        step: document.getElementById('bw-step'),
        reset: document.getElementById('bw-reset'),
        reroll: document.getElementById('bw-reroll'),
        bias: document.getElementById('bw-bias'),
        biasValue: document.getElementById('bw-bias-value'),
        speed: document.getElementById('bw-speed'),
        speedValue: document.getElementById('bw-speed-value'),
        seed: document.getElementById('bw-seed'),
        status: document.getElementById('bw-status'),
        live: document.querySelector('.biased-walk-live'),
        equation: document.getElementById('bw-equation'),
        steps: document.getElementById('bw-steps'),
        x: document.getElementById('bw-x'),
        y: document.getElementById('bw-y'),
        expectedX: document.getElementById('bw-expected-x')
    };

    let W = 0, H = 0, dpr = 1;
    let rng = makeRng('right-drift');
    let walker = { x: 0, y: 0, path: [{ x: 0, y: 0 }] };
    let stepCount = 0;
    let running = false;
    let visible = projectActive && !document.hidden;
    let rafId = 0;

    function clamp(v, lo, hi) {
        return v < lo ? lo : v > hi ? hi : v;
    }

    function num(el, fallback) {
        const value = parseInt(el && el.value, 10);
        return Number.isFinite(value) ? value : fallback;
    }

    function fmt(value) {
        const abs = Math.abs(value);
        if (abs >= 1000) return Math.round(value).toString();
        if (abs >= 100) return value.toFixed(1);
        return value.toFixed(2);
    }

    function fmtProb(value) {
        return value.toFixed(2);
    }

    function hashSeed(text) {
        let h = 2166136261;
        const input = String(text || 'right-biased-walk');
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

    function rightProbability() {
        return clamp(num(ui.bias, 55), 26, 85) / 100;
    }

    function sideProbability() {
        return (1 - rightProbability()) / 3;
    }

    function driftPerStep() {
        return rightProbability() - sideProbability();
    }

    function varianceXPerStep() {
        const east = rightProbability();
        const west = sideProbability();
        const drift = east - west;
        return east + west - drift * drift;
    }

    function varianceYPerStep() {
        return 2 * sideProbability();
    }

    function resetWalker() {
        walker = { x: 0, y: 0, path: [{ x: 0, y: 0 }] };
    }

    function compactPath() {
        const limit = 9000;
        if (walker.path.length <= limit) return;

        const path = walker.path;
        const compact = [path[0]];
        const offset = path.length % 2 ? 1 : 2;
        for (let i = offset; i < path.length - 1; i += 2) compact.push(path[i]);
        compact.push(path[path.length - 1]);
        walker.path = compact;
    }

    function reset() {
        rng = makeRng(ui.seed && ui.seed.value);
        stepCount = 0;
        resetWalker();
        updateReadouts();
        render();
        if (running && visible) startLoop();
    }

    function advance(steps) {
        const east = rightProbability();
        const side = sideProbability();
        const northCutoff = side;
        const eastCutoff = northCutoff + east;
        const southCutoff = eastCutoff + side;

        for (let s = 0; s < steps; s++) {
            const r = rng();
            if (r < northCutoff) walker.y += 1;
            else if (r < eastCutoff) walker.x += 1;
            else if (r < southCutoff) walker.y -= 1;
            else walker.x -= 1;

            walker.path.push({ x: walker.x, y: walker.y });
            compactPath();
            stepCount++;
        }
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

    function measureBounds() {
        const expectedX = driftPerStep() * stepCount;
        const stdX = Math.sqrt(Math.max(0, varianceXPerStep() * stepCount));
        const stdY = Math.sqrt(Math.max(0, varianceYPerStep() * stepCount));
        let minX = Math.min(-8, expectedX - stdX * 2.2);
        let maxX = Math.max(24, expectedX + stdX * 2.2);
        let minY = Math.min(-16, -stdY * 2.6);
        let maxY = Math.max(16, stdY * 2.6);
        const path = walker.path;
        const stride = Math.max(1, Math.floor(path.length / 900));

        for (let i = 0; i < path.length; i += stride) {
            const p = path[i];
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }

        minX = Math.min(minX, walker.x, 0);
        maxX = Math.max(maxX, walker.x, 0);
        minY = Math.min(minY, walker.y, 0);
        maxY = Math.max(maxY, walker.y, 0);

        return { minX, maxX, minY, maxY };
    }

    function viewTransform() {
        const pad = W < 620 ? 24 : 34;
        const bounds = measureBounds();
        const width = Math.max(1, bounds.maxX - bounds.minX);
        const height = Math.max(1, bounds.maxY - bounds.minY);
        const plotW = Math.max(1, W - pad * 2);
        const plotH = Math.max(1, H - pad * 2);
        const scale = Math.min(plotW / width, plotH / height);
        const extraX = plotW - width * scale;
        const extraY = plotH - height * scale;
        const cx = pad + extraX / 2 - bounds.minX * scale;
        const cy = pad + extraY / 2 + bounds.maxY * scale;
        return { cx, cy, scale, bounds };
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
        const bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, '#05060a');
        bg.addColorStop(0.56, '#060a0b');
        bg.addColorStop(1, '#030407');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        const glow = ctx.createLinearGradient(0, H * 0.5, W, H * 0.5);
        glow.addColorStop(0, 'rgba(255,46,68,0.035)');
        glow.addColorStop(0.62, 'rgba(151,255,174,0.08)');
        glow.addColorStop(1, 'rgba(120,240,255,0.035)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
    }

    function drawGrid(cx, cy, scale, bounds) {
        const gridStep = niceStep(44 / scale);
        const minX = Math.floor(bounds.minX / gridStep) * gridStep;
        const maxX = Math.ceil(bounds.maxX / gridStep) * gridStep;
        const minY = Math.floor(bounds.minY / gridStep) * gridStep;
        const maxY = Math.ceil(bounds.maxY / gridStep) * gridStep;

        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(151,255,174,0.07)';
        ctx.beginPath();
        for (let x = minX; x <= maxX; x += gridStep) {
            const px = cx + x * scale;
            ctx.moveTo(px, 0);
            ctx.lineTo(px, H);
        }
        for (let y = minY; y <= maxY; y += gridStep) {
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

    function drawDriftEnvelope(cx, cy, scale) {
        if (!stepCount) return;
        const expectedX = driftPerStep() * stepCount;
        const stdX = Math.sqrt(Math.max(0, varianceXPerStep() * stepCount));
        const stdY = Math.sqrt(Math.max(0, varianceYPerStep() * stepCount));
        const ex = cx + expectedX * scale;
        const radiusX = Math.max(5, stdX * scale);
        const radiusY = Math.max(5, stdY * scale);

        ctx.globalCompositeOperation = 'source-over';
        ctx.save();
        ctx.setLineDash([7, 9]);
        ctx.strokeStyle = 'rgba(151,255,174,0.34)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(ex, cy, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    function drawDriftVector(cx, cy, scale) {
        if (!stepCount) return;
        const expectedX = driftPerStep() * stepCount;
        const ex = cx + expectedX * scale;
        const distance = ex - cx;

        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(151,255,174,0.55)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, cy);
        ctx.stroke();

        if (Math.abs(distance) < 18) return;
        const dir = distance >= 0 ? 1 : -1;
        ctx.fillStyle = 'rgba(151,255,174,0.75)';
        ctx.beginPath();
        ctx.moveTo(ex, cy);
        ctx.lineTo(ex - dir * 10, cy - 5);
        ctx.lineTo(ex - dir * 10, cy + 5);
        ctx.closePath();
        ctx.fill();
    }

    function drawPath(cx, cy, scale) {
        const path = walker.path;
        const stride = Math.max(1, Math.floor(path.length / 1800));

        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = rgba([151, 255, 174], 0.68);
        ctx.lineWidth = 1.55;
        ctx.beginPath();
        ctx.moveTo(cx + path[0].x * scale, cy - path[0].y * scale);
        for (let i = stride; i < path.length; i += stride) {
            ctx.lineTo(cx + path[i].x * scale, cy - path[i].y * scale);
        }
        const last = path[path.length - 1];
        ctx.lineTo(cx + last.x * scale, cy - last.y * scale);
        ctx.stroke();

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = rgba([120, 240, 255], 0.94);
        const size = 5;
        ctx.fillRect(cx + walker.x * scale - size / 2, cy - walker.y * scale - size / 2, size, size);
    }

    function drawOrigin(cx, cy) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(247,238,240,0.76)';
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
        const g = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.24, W * 0.5, H * 0.5, Math.max(W, H) * 0.76);
        g.addColorStop(0, 'rgba(3,4,7,0)');
        g.addColorStop(1, 'rgba(3,4,7,0.66)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    }

    function render() {
        if (!W || !H) return;
        const view = viewTransform();

        drawBackground();
        drawGrid(view.cx, view.cy, view.scale, view.bounds);
        drawDriftEnvelope(view.cx, view.cy, view.scale);
        drawDriftVector(view.cx, view.cy, view.scale);
        drawPath(view.cx, view.cy, view.scale);
        drawOrigin(view.cx, view.cy);
        drawVignette();
    }

    function updateReadouts() {
        const east = rightProbability();
        const side = sideProbability();
        const expectedX = driftPerStep() * stepCount;

        if (ui.biasValue) ui.biasValue.textContent = fmtProb(east);
        if (ui.speedValue) ui.speedValue.textContent = String(clamp(num(ui.speed, 10), 1, 32));
        if (ui.equation) ui.equation.textContent = 'P(E) = ' + fmtProb(east) + '; P(N,S,W) = ' + fmtProb(side);
        if (ui.steps) ui.steps.textContent = String(stepCount);
        if (ui.x) ui.x.textContent = String(walker.x);
        if (ui.y) ui.y.textContent = String(walker.y);
        if (ui.expectedX) ui.expectedX.textContent = fmt(expectedX);
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
        advance(clamp(num(ui.speed, 10), 1, 32));
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

    if (ui.bias) ui.bias.addEventListener('input', reset);
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
        visible = projectActive && !document.hidden;
        if (visible && running) startLoop();
        else stopLoop();
        updateReadouts();
    });

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            visible = projectActive && entries.some(entry => entry.isIntersecting) && !document.hidden;
            if (visible && running) startLoop();
            else stopLoop();
            updateReadouts();
        }, { threshold: 0, rootMargin: '100px' });
        observer.observe(frame);
    }

    if (projectPanel) {
        projectPanel.addEventListener('project-panel-change', (event) => {
            projectActive = !!event.detail.active;
            visible = projectActive && !document.hidden;
            if (!projectActive) {
                running = false;
                stopLoop();
            } else {
                resize();
                if (running && visible) startLoop();
            }
            updateReadouts();
        });
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
