// Magnetic Fireflies.
//
// Each firefly drifts under a small wandering acceleration. When the pointer is
// nearby, it computes direction = mouse - position and adds a scaled version of
// that vector to its velocity.

(function () {
    'use strict';

    const canvas = document.getElementById('fireflies-canvas');
    if (!canvas) return;

    const frame = canvas.parentElement;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const projectPanel = canvas.closest('[data-project-panel]');
    let projectActive = !projectPanel || !projectPanel.hidden;
    let inViewport = projectActive;

    const reduceMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const ui = {
        toggle: document.getElementById('ff-toggle'),
        scatter: document.getElementById('ff-scatter'),
        reset: document.getElementById('ff-reset'),
        count: document.getElementById('ff-count'),
        countValue: document.getElementById('ff-count-value'),
        radius: document.getElementById('ff-radius'),
        radiusValue: document.getElementById('ff-radius-value'),
        strength: document.getElementById('ff-strength'),
        strengthValue: document.getElementById('ff-strength-value'),
        repel: document.getElementById('ff-repel'),
        vectors: document.getElementById('ff-vectors'),
        status: document.getElementById('ff-status'),
        live: document.querySelector('.fireflies-live'),
        equation: document.getElementById('ff-equation'),
        active: document.getElementById('ff-active'),
        nearest: document.getElementById('ff-nearest'),
        direction: document.getElementById('ff-direction'),
        force: document.getElementById('ff-force')
    };

    const COLORS = [
        [223, 255, 117],
        [151, 255, 174],
        [120, 240, 255],
        [255, 191, 105],
        [255, 45, 166]
    ];

    let W = 0, H = 0, dpr = 1;
    let rng = makeRng('magnetic-fireflies');
    let fireflies = [];
    let running = !reduceMotion;
    let visible = projectActive && inViewport && !document.hidden;
    let rafId = 0;
    let lastTime = 0;
    let time = 0;

    const pointer = {
        x: 0,
        y: 0,
        inside: false
    };

    const stats = {
        active: 0,
        nearest: 0,
        directionX: 0,
        directionY: 0,
        force: 0,
        selected: null
    };

    function clamp(v, lo, hi) {
        return v < lo ? lo : v > hi ? hi : v;
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function num(el, fallback) {
        const value = parseInt(el && el.value, 10);
        return Number.isFinite(value) ? value : fallback;
    }

    function fmt(value, digits) {
        if (!Number.isFinite(value)) return '0.00';
        return value.toFixed(digits == null ? 2 : digits);
    }

    function hashSeed(text) {
        let h = 2166136261;
        const input = String(text || 'magnetic-fireflies');
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

    function randomRange(lo, hi) {
        return lo + (hi - lo) * rng();
    }

    function currentCount() {
        return clamp(num(ui.count, 36), 20, 50);
    }

    function magnetRadius() {
        return clamp(num(ui.radius, 180), 80, 280);
    }

    function magnetStrength() {
        return clamp(num(ui.strength, 42), 0, 100) / 100;
    }

    function isRepelling() {
        return !!(ui.repel && ui.repel.checked);
    }

    function showVectors() {
        return !ui.vectors || ui.vectors.checked;
    }

    function rgba(rgb, alpha) {
        return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')';
    }

    function makeFirefly(index) {
        const color = COLORS[index % COLORS.length];
        return {
            x: randomRange(W * 0.12, W * 0.88),
            y: randomRange(H * 0.12, H * 0.88),
            vx: randomRange(-28, 28),
            vy: randomRange(-28, 28),
            size: randomRange(2.1, 4.4),
            phase: randomRange(0, Math.PI * 2),
            drift: randomRange(0.55, 1.45),
            color,
            trail: [],
            forceX: 0,
            forceY: 0,
            influence: 0
        };
    }

    function syncFireflyCount() {
        const target = currentCount();
        while (fireflies.length < target) fireflies.push(makeFirefly(fireflies.length));
        if (fireflies.length > target) fireflies.splice(target);
    }

    function resetFireflies() {
        rng = makeRng('magnetic-fireflies-' + Math.round(performance.now()));
        fireflies = [];
        syncFireflyCount();
        stats.selected = null;
    }

    function reset() {
        time = 0;
        lastTime = 0;
        resetFireflies();
        updateReadouts();
        render();
        if (running && visible) startLoop();
    }

    function scatter() {
        const origin = pointer.inside ? pointer : { x: W * 0.5, y: H * 0.5 };
        for (const f of fireflies) {
            const dx = f.x - origin.x;
            const dy = f.y - origin.y;
            const dist = Math.max(1, Math.hypot(dx, dy));
            const burst = randomRange(80, 180);
            f.vx += dx / dist * burst + randomRange(-38, 38);
            f.vy += dy / dist * burst + randomRange(-38, 38);
        }
        render();
    }

    function updateStats() {
        stats.active = 0;
        stats.nearest = 0;
        stats.directionX = 0;
        stats.directionY = 0;
        stats.force = 0;
        stats.selected = null;

        if (!pointer.inside || !fireflies.length) return;

        let bestDistance = Infinity;
        for (const f of fireflies) {
            const dx = pointer.x - f.x;
            const dy = pointer.y - f.y;
            const dist = Math.hypot(dx, dy);
            if (f.influence > 0.001) stats.active++;
            if (dist < bestDistance) {
                bestDistance = dist;
                stats.selected = f;
                stats.directionX = dx;
                stats.directionY = dy;
                stats.force = magnetStrength() * f.influence * f.influence;
            }
        }
        stats.nearest = Number.isFinite(bestDistance) ? bestDistance : 0;
    }

    function resize() {
        const oldW = W;
        const oldH = H;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        const r = frame.getBoundingClientRect();
        W = Math.max(1, Math.round(r.width));
        H = Math.max(1, Math.round(r.height));
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        if (!fireflies.length || oldW <= 2 || oldH <= 2) {
            resetFireflies();
        } else {
            const sx = W / oldW;
            const sy = H / oldH;
            for (const f of fireflies) {
                f.x *= sx;
                f.y *= sy;
                f.trail = [];
            }
        }
        if (!pointer.inside) {
            pointer.x = W * 0.5;
            pointer.y = H * 0.5;
        }
        updateStats();
        render();
        updateReadouts();
    }

    function edgeForce(f) {
        const margin = Math.min(W, H) * 0.12;
        let ax = 0;
        let ay = 0;
        if (f.x < margin) ax += (margin - f.x) / margin;
        if (f.x > W - margin) ax -= (f.x - (W - margin)) / margin;
        if (f.y < margin) ay += (margin - f.y) / margin;
        if (f.y > H - margin) ay -= (f.y - (H - margin)) / margin;
        return { x: ax, y: ay };
    }

    function pushTrail(f, dt) {
        for (const p of f.trail) p.age += dt;
        while (f.trail.length && f.trail[0].age > 1.45) f.trail.shift();
        f.trail.push({ x: f.x, y: f.y, age: 0 });
        if (f.trail.length > 44) f.trail.splice(0, f.trail.length - 44);
    }

    function updateFirefly(f, dt) {
        const wanderAngle = f.phase + time * (0.55 + f.drift * 0.32) +
            Math.sin(time * 0.27 + f.phase) * 1.4;
        const wander = 18 + f.drift * 18;
        let ax = Math.cos(wanderAngle) * wander;
        let ay = Math.sin(wanderAngle * 0.86 + f.phase) * wander;

        const edge = edgeForce(f);
        ax += edge.x * 150;
        ay += edge.y * 150;

        f.influence = 0;
        f.forceX = lerp(f.forceX, 0, 0.08);
        f.forceY = lerp(f.forceY, 0, 0.08);

        if (pointer.inside) {
            const dx = pointer.x - f.x;
            const dy = pointer.y - f.y;
            const dist = Math.max(0.001, Math.hypot(dx, dy));
            const radius = magnetRadius();
            const influence = clamp(1 - dist / radius, 0, 1);
            if (influence > 0) {
                const sign = isRepelling() ? -1 : 1;
                const force = magnetStrength() * influence * influence * 330;
                const ux = dx / dist;
                const uy = dy / dist;
                ax += sign * ux * force;
                ay += sign * uy * force;
                f.forceX = sign * ux * influence;
                f.forceY = sign * uy * influence;
                f.influence = influence;
            }
        }

        f.vx += ax * dt;
        f.vy += ay * dt;
        f.vx *= Math.pow(0.985, dt * 60);
        f.vy *= Math.pow(0.985, dt * 60);

        const speed = Math.hypot(f.vx, f.vy);
        const maxSpeed = 82 + magnetStrength() * 92;
        if (speed > maxSpeed) {
            f.vx = f.vx / speed * maxSpeed;
            f.vy = f.vy / speed * maxSpeed;
        }

        f.x += f.vx * dt;
        f.y += f.vy * dt;

        const pad = 10;
        if (f.x < pad) {
            f.x = pad;
            f.vx = Math.abs(f.vx) * 0.74;
        } else if (f.x > W - pad) {
            f.x = W - pad;
            f.vx = -Math.abs(f.vx) * 0.74;
        }

        if (f.y < pad) {
            f.y = pad;
            f.vy = Math.abs(f.vy) * 0.74;
        } else if (f.y > H - pad) {
            f.y = H - pad;
            f.vy = -Math.abs(f.vy) * 0.74;
        }

        pushTrail(f, dt);
    }

    function update(dt) {
        time += dt;
        syncFireflyCount();
        for (const f of fireflies) updateFirefly(f, dt);
        updateStats();
    }

    function drawBackground() {
        ctx.globalCompositeOperation = 'source-over';
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#05070d');
        bg.addColorStop(0.52, '#06090b');
        bg.addColorStop(1, '#030405');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        const lime = ctx.createRadialGradient(W * 0.28, H * 0.22, 0, W * 0.28, H * 0.22, Math.max(W, H) * 0.62);
        lime.addColorStop(0, 'rgba(223,255,117,0.14)');
        lime.addColorStop(0.35, 'rgba(151,255,174,0.055)');
        lime.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = lime;
        ctx.fillRect(0, 0, W, H);

        const cyan = ctx.createRadialGradient(W * 0.78, H * 0.72, 0, W * 0.78, H * 0.72, Math.max(W, H) * 0.48);
        cyan.addColorStop(0, 'rgba(120,240,255,0.10)');
        cyan.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cyan;
        ctx.fillRect(0, 0, W, H);
    }

    function drawGrid() {
        const step = W < 620 ? 52 : 64;
        const drift = (time * 8) % step;
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(223,255,117,0.055)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = -step + drift; x <= W + step; x += step) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
        }
        for (let y = -step + drift * 0.55; y <= H + step; y += step) {
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
        }
        ctx.stroke();
    }

    function drawMagnet() {
        if (!pointer.inside) return;

        const radius = magnetRadius();
        const color = isRepelling() ? [255, 191, 105] : [120, 240, 255];
        const g = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, radius);
        g.addColorStop(0, rgba(color, 0.12));
        g.addColorStop(0.58, rgba(color, 0.035));
        g.addColorStop(1, rgba(color, 0));
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(pointer.x, pointer.y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalCompositeOperation = 'source-over';
        ctx.save();
        ctx.setLineDash([8, 10]);
        ctx.strokeStyle = rgba(color, 0.34);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(pointer.x, pointer.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = rgba(color, 0.78);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pointer.x - 10, pointer.y);
        ctx.lineTo(pointer.x + 10, pointer.y);
        ctx.moveTo(pointer.x, pointer.y - 10);
        ctx.lineTo(pointer.x, pointer.y + 10);
        ctx.stroke();
    }

    function drawArrow(x1, y1, x2, y2, color, width) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len < 0.5) return;

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        if (len < 7) return;
        const angle = Math.atan2(dy, dx);
        const head = clamp(len * 0.24, 5, 9);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - Math.cos(angle - 0.58) * head, y2 - Math.sin(angle - 0.58) * head);
        ctx.lineTo(x2 - Math.cos(angle + 0.58) * head, y2 - Math.sin(angle + 0.58) * head);
        ctx.closePath();
        ctx.fill();
    }

    function drawVectors() {
        if (!pointer.inside || !showVectors()) return;

        const selected = stats.selected;
        const repel = isRepelling();
        ctx.globalCompositeOperation = 'source-over';

        for (const f of fireflies) {
            if (f.influence <= 0.025) continue;
            const len = 12 + f.influence * 48;
            const x2 = f.x + f.forceX * len;
            const y2 = f.y + f.forceY * len;
            const color = repel ?
                'rgba(255,191,105,' + (0.18 + f.influence * 0.48).toFixed(3) + ')' :
                'rgba(120,240,255,' + (0.18 + f.influence * 0.48).toFixed(3) + ')';
            drawArrow(f.x, f.y, x2, y2, color, 1.15);
        }

        if (selected) {
            ctx.save();
            ctx.setLineDash([5, 8]);
            ctx.strokeStyle = repel ? 'rgba(255,191,105,0.58)' : 'rgba(120,240,255,0.58)';
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(selected.x, selected.y);
            ctx.lineTo(pointer.x, pointer.y);
            ctx.stroke();
            ctx.restore();

            ctx.fillStyle = 'rgba(247,238,240,0.9)';
            ctx.beginPath();
            ctx.arc(selected.x, selected.y, selected.size + 3.2, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(247,238,240,0.5)';
            ctx.stroke();
        }
    }

    function drawTrail(f) {
        if (f.trail.length < 2) return;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = 1; i < f.trail.length; i++) {
            const a = f.trail[i - 1];
            const b = f.trail[i];
            const life = clamp(1 - b.age / 1.45, 0, 1);
            ctx.strokeStyle = rgba(f.color, life * 0.16);
            ctx.lineWidth = f.size * (0.18 + life * 0.48);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
    }

    function drawFirefly(f) {
        const pulse = 0.66 + 0.34 * Math.sin(time * (2.4 + f.drift) + f.phase);
        const aura = f.size * (6.5 + pulse * 2.8 + f.influence * 8);
        const core = f.size * (0.8 + pulse * 0.28 + f.influence * 0.24);

        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, aura);
        g.addColorStop(0, rgba(f.color, 0.62 + f.influence * 0.18));
        g.addColorStop(0.22, rgba(f.color, 0.18 + f.influence * 0.22));
        g.addColorStop(1, rgba(f.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, aura, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,226,0.95)';
        ctx.beginPath();
        ctx.arc(f.x, f.y, core, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawFireflies() {
        for (const f of fireflies) drawTrail(f);
        for (const f of fireflies) drawFirefly(f);
    }

    function drawVignette() {
        ctx.globalCompositeOperation = 'source-over';
        const g = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.24, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
        g.addColorStop(0, 'rgba(3,4,7,0)');
        g.addColorStop(1, 'rgba(3,4,7,0.72)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    }

    function render() {
        if (!W || !H) return;
        drawBackground();
        drawGrid();
        drawMagnet();
        drawVectors();
        drawFireflies();
        drawVignette();
    }

    function updateReadouts() {
        const count = currentCount();
        const radius = magnetRadius();
        const strength = magnetStrength();
        const mode = isRepelling() ? 'repulsion' : 'attraction';

        if (ui.countValue) ui.countValue.textContent = String(count);
        if (ui.radiusValue) ui.radiusValue.textContent = String(radius);
        if (ui.strengthValue) ui.strengthValue.textContent = fmt(strength, 2);
        if (ui.active) ui.active.textContent = String(stats.active);
        if (ui.nearest) ui.nearest.textContent = pointer.inside ? String(Math.round(stats.nearest)) : '0';
        if (ui.direction) {
            ui.direction.textContent = pointer.inside ?
                Math.round(stats.directionX) + ', ' + Math.round(stats.directionY) :
                '0, 0';
        }
        if (ui.force) ui.force.textContent = fmt(stats.force, 2);
        if (ui.status) ui.status.textContent = running ? (pointer.inside ? 'Magnetized' : 'Drifting') : 'Idle';
        if (ui.toggle) ui.toggle.textContent = running ? 'Pause' : 'Start';
        if (ui.live) ui.live.classList.toggle('is-running', running && visible);
        if (ui.equation) ui.equation.textContent = 'direction = mouse - position; velocity += direction * ' + mode;
    }

    function tick(now) {
        if (!(running && visible)) {
            rafId = 0;
            lastTime = 0;
            updateReadouts();
            return;
        }
        const seconds = now ? now / 1000 : time + 1 / 60;
        const dt = lastTime ? clamp(seconds - lastTime, 0.001, 0.033) : 1 / 60;
        lastTime = seconds;
        update(dt);
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
        lastTime = 0;
    }

    function refreshVisibility() {
        visible = projectActive && inViewport && !document.hidden;
        if (visible && running) startLoop();
        else stopLoop();
        updateReadouts();
    }

    if (ui.toggle) {
        ui.toggle.addEventListener('click', () => {
            running = !running;
            refreshVisibility();
        });
    }

    if (ui.scatter) ui.scatter.addEventListener('click', scatter);
    if (ui.reset) ui.reset.addEventListener('click', reset);

    if (ui.count) {
        ui.count.addEventListener('input', () => {
            syncFireflyCount();
            updateStats();
            render();
            updateReadouts();
        });
    }

    for (const control of [ui.radius, ui.strength, ui.repel, ui.vectors]) {
        if (!control) continue;
        control.addEventListener('input', () => {
            updateStats();
            render();
            updateReadouts();
        });
        control.addEventListener('change', () => {
            updateStats();
            render();
            updateReadouts();
        });
    }

    canvas.addEventListener('pointerenter', (event) => {
        const rect = canvas.getBoundingClientRect();
        pointer.x = event.clientX - rect.left;
        pointer.y = event.clientY - rect.top;
        pointer.inside = true;
        updateStats();
        updateReadouts();
    });

    canvas.addEventListener('pointermove', (event) => {
        const rect = canvas.getBoundingClientRect();
        pointer.x = event.clientX - rect.left;
        pointer.y = event.clientY - rect.top;
        pointer.inside = true;
    });

    canvas.addEventListener('pointerleave', () => {
        pointer.inside = false;
        updateStats();
        updateReadouts();
    });

    canvas.addEventListener('pointerdown', (event) => {
        const rect = canvas.getBoundingClientRect();
        pointer.x = event.clientX - rect.left;
        pointer.y = event.clientY - rect.top;
        pointer.inside = true;
        scatter();
    });

    document.addEventListener('visibilitychange', refreshVisibility);

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            inViewport = entries.some(entry => entry.isIntersecting);
            refreshVisibility();
        }, { threshold: 0, rootMargin: '120px' });
        observer.observe(frame);
    }

    if (projectPanel) {
        projectPanel.addEventListener('project-panel-change', (event) => {
            projectActive = !!event.detail.active;
            inViewport = projectActive;
            if (projectActive) resize();
            refreshVisibility();
        });
    }

    if ('ResizeObserver' in window) {
        const ro = new ResizeObserver(resize);
        ro.observe(frame);
    } else {
        window.addEventListener('resize', resize);
    }

    resize();
    updateReadouts();
    if (running && visible) startLoop();
})();
