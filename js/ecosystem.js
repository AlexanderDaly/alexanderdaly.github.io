// Ecosystem Drift Lab.
//
// A behavior-first creature simulation: a nervous flying bug and a floating
// leaf move through a seeded, layered noise field.

(function () {
    'use strict';

    const canvas = document.getElementById('ecosystem-canvas');
    if (!canvas) return;

    const frame = canvas.parentElement;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    const projectPanel = canvas.closest('[data-project-panel]');
    let projectActive = !projectPanel || !projectPanel.hidden;

    const ui = {
        toggle: document.getElementById('eco-toggle'),
        disturb: document.getElementById('eco-disturb'),
        reset: document.getElementById('eco-reset'),
        reroll: document.getElementById('eco-reroll'),
        nerves: document.getElementById('eco-bug-nerves'),
        nervesValue: document.getElementById('eco-bug-nerves-value'),
        chaos: document.getElementById('eco-breeze-chaos'),
        chaosValue: document.getElementById('eco-breeze-chaos-value'),
        seed: document.getElementById('eco-seed'),
        status: document.getElementById('eco-status'),
        live: document.querySelector('.ecosystem-live'),
        bugState: document.getElementById('eco-bug-state'),
        wind: document.getElementById('eco-wind'),
        leafSpin: document.getElementById('eco-leaf-spin'),
        startles: document.getElementById('eco-startles')
    };

    let W = 0, H = 0, dpr = 1;
    let rng = makeRng('mote-field');
    let seedHash = hashSeed('mote-field');
    let running = false;
    let visible = projectActive && !document.hidden;
    let rafId = 0;
    let lastTime = 0;
    let time = 0;
    let startleCount = 0;
    let windPower = 0;
    let disturbance = null;
    let bug = null;
    let leaf = null;
    let nectar = [];
    let motes = [];
    let stems = [];

    function clamp(v, lo, hi) {
        return v < lo ? lo : v > hi ? hi : v;
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function smooth(t) {
        return t * t * (3 - 2 * t);
    }

    function num(el, fallback) {
        const value = parseInt(el && el.value, 10);
        return Number.isFinite(value) ? value : fallback;
    }

    function fmt(value) {
        return Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
    }

    function hashSeed(text) {
        let h = 2166136261;
        const input = String(text || 'ecosystem');
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

    function hash3(ix, iy, iz, salt) {
        let h = seedHash ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^
            Math.imul(iz, 2246822519) ^ Math.imul(salt, 3266489917);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    }

    function noise3(x, y, z, salt) {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const iz = Math.floor(z);
        const fx = smooth(x - ix);
        const fy = smooth(y - iy);
        const fz = smooth(z - iz);

        function n(dx, dy, dz) {
            return hash3(ix + dx, iy + dy, iz + dz, salt);
        }

        const x00 = lerp(n(0, 0, 0), n(1, 0, 0), fx);
        const x10 = lerp(n(0, 1, 0), n(1, 1, 0), fx);
        const x01 = lerp(n(0, 0, 1), n(1, 0, 1), fx);
        const x11 = lerp(n(0, 1, 1), n(1, 1, 1), fx);
        const y0 = lerp(x00, x10, fy);
        const y1 = lerp(x01, x11, fy);
        return lerp(y0, y1, fz);
    }

    function fbm(x, y, z, salt, octaves) {
        let total = 0;
        let amp = 0.5;
        let scale = 1;
        let norm = 0;
        for (let i = 0; i < octaves; i++) {
            total += noise3(x * scale, y * scale, z * scale, salt + i * 19) * amp;
            norm += amp;
            amp *= 0.5;
            scale *= 2;
        }
        return total / Math.max(0.0001, norm);
    }

    function bugNerves() {
        return clamp(num(ui.nerves, 72), 10, 95) / 100;
    }

    function breezeChaos() {
        return clamp(num(ui.chaos, 58), 5, 95) / 100;
    }

    function randomRange(lo, hi) {
        return lerp(lo, hi, rng());
    }

    function buildWorld() {
        nectar = [];
        motes = [];
        stems = [];

        const count = 5;
        for (let i = 0; i < count; i++) {
            nectar.push({
                x: randomRange(0.15, 0.88),
                y: randomRange(0.18, 0.82),
                pulse: randomRange(0, Math.PI * 2),
                radius: randomRange(13, 24),
                hue: rng() < 0.5 ? 'cyan' : 'amber'
            });
        }

        for (let i = 0; i < 150; i++) {
            motes.push({
                x: rng(),
                y: rng(),
                size: randomRange(0.6, 2.2),
                phase: randomRange(0, Math.PI * 2),
                depth: randomRange(0.35, 1)
            });
        }

        for (let i = 0; i < 30; i++) {
            stems.push({
                x: rng(),
                height: randomRange(0.12, 0.38),
                bend: randomRange(-0.24, 0.24),
                phase: randomRange(0, Math.PI * 2),
                bloom: rng() < 0.34
            });
        }
    }

    function resetActors() {
        bug = {
            x: W * randomRange(0.24, 0.76),
            y: H * randomRange(0.24, 0.58),
            vx: randomRange(-34, 34),
            vy: randomRange(-28, 28),
            heading: randomRange(-Math.PI, Math.PI),
            wing: randomRange(0, Math.PI * 2),
            target: Math.floor(rng() * Math.max(1, nectar.length)),
            dartTimer: 0,
            dartAngle: 0,
            startleTimer: 0,
            state: 'Hunting',
            trail: []
        };

        leaf = {
            x: W * randomRange(0.18, 0.82),
            y: H * randomRange(0.12, 0.36),
            vx: randomRange(-18, 18),
            vy: randomRange(8, 28),
            angle: randomRange(-Math.PI, Math.PI),
            av: randomRange(-0.7, 0.7),
            wobble: randomRange(0, Math.PI * 2),
            trail: []
        };
    }

    function reset() {
        rng = makeRng(ui.seed && ui.seed.value);
        seedHash = hashSeed(ui.seed && ui.seed.value);
        time = 0;
        lastTime = 0;
        startleCount = 0;
        windPower = 0;
        disturbance = null;
        buildWorld();
        resetActors();
        updateReadouts();
        render();
        if (running && visible) startLoop();
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
        resetActors();
        render();
    }

    function windAt(x, y, t) {
        const chaos = breezeChaos();
        const nx = x / Math.max(1, W);
        const ny = y / Math.max(1, H);
        const z = t * (0.035 + chaos * 0.055);
        const e = 0.035;

        const up = fbm(nx * 2.4, (ny + e) * 2.4, z, 31, 4);
        const down = fbm(nx * 2.4, (ny - e) * 2.4, z, 31, 4);
        const right = fbm((nx + e) * 2.4, ny * 2.4, z, 31, 4);
        const left = fbm((nx - e) * 2.4, ny * 2.4, z, 31, 4);

        const curlX = (up - down) / (e * 2);
        const curlY = -(right - left) / (e * 2);
        const angleNoise = fbm(nx * 1.25 + 9, ny * 1.25 - 4, z * 0.7, 71, 3);
        const globalGust = 0.55 + fbm(t * 0.09, 4.7, 1.3, 89, 3);
        const gustPulse = Math.pow(fbm(t * 0.18, 8.1, 2.9, 107, 2), 3);
        const base = 24 + chaos * 84 + gustPulse * 46;

        return {
            x: (0.42 + (angleNoise - 0.5) * 0.68 + curlX * 0.18) * base * globalGust,
            y: (-0.08 + (fbm(nx * 1.8, ny * 1.8, z + 5, 47, 3) - 0.5) * 0.72 + curlY * 0.14) * base,
            gust: globalGust + gustPulse
        };
    }

    function chooseNewTarget() {
        if (!nectar.length) return;
        let next = Math.floor(rng() * nectar.length);
        if (next === bug.target) next = (next + 1) % nectar.length;
        bug.target = next;
    }

    function pushTrail(trail, x, y, limit) {
        trail.push({ x, y, age: 0 });
        if (trail.length > limit) trail.splice(0, trail.length - limit);
    }

    function ageTrail(trail, dt) {
        for (const p of trail) p.age += dt;
        while (trail.length && trail[0].age > 2.4) trail.shift();
    }

    function edgeForce(x, y, margin) {
        let fx = 0, fy = 0;
        if (x < margin) fx += (margin - x) / margin;
        if (x > W - margin) fx -= (x - (W - margin)) / margin;
        if (y < margin) fy += (margin - y) / margin;
        if (y > H - margin) fy -= (y - (H - margin)) / margin;
        return { x: fx, y: fy };
    }

    function disturbAt(x, y) {
        disturbance = { x, y, age: 0, life: 1.4 };
        bug.startleTimer = 0.96 + rng() * 0.5;
        bug.dartTimer = 0.28;
        bug.dartAngle = Math.atan2(bug.y - y, bug.x - x) + randomRange(-0.45, 0.45);
        leaf.av += randomRange(-4.2, 4.2);
        leaf.vx += (leaf.x - x) * 0.38;
        leaf.vy += (leaf.y - y) * 0.12 - 28;
        startleCount++;
        bug.state = 'Startled';
        render();
        updateReadouts();
    }

    function disturbRandom() {
        const x = bug ? bug.x + randomRange(-60, 60) : W * 0.5;
        const y = bug ? bug.y + randomRange(-60, 60) : H * 0.45;
        disturbAt(clamp(x, 0, W), clamp(y, 0, H));
    }

    function updateBug(dt) {
        const nerves = bugNerves();
        const wind = windAt(bug.x, bug.y, time);
        const target = nectar[bug.target % Math.max(1, nectar.length)];
        const tx = target ? target.x * W : W * 0.5;
        const ty = target ? target.y * H : H * 0.5;
        const dx = tx - bug.x;
        const dy = ty - bug.y;
        const dist = Math.max(1, Math.hypot(dx, dy));

        if (dist < 34 + target.radius || rng() < dt * 0.07) chooseNewTarget();

        if (bug.dartTimer <= 0 && rng() < dt * (0.22 + nerves * 0.92)) {
            bug.dartTimer = randomRange(0.12, 0.26);
            bug.dartAngle = randomRange(-Math.PI, Math.PI);
        }

        const wanderAngle = (fbm(time * 0.55, bug.x * 0.006, bug.y * 0.006, 131, 3) - 0.5) * Math.PI * 4;
        const jitterAngle = randomRange(-Math.PI, Math.PI);
        let ax = Math.cos(wanderAngle) * (28 + nerves * 56) + Math.cos(jitterAngle) * nerves * 90;
        let ay = Math.sin(wanderAngle) * (28 + nerves * 56) + Math.sin(jitterAngle) * nerves * 90;

        ax += (dx / dist) * (34 + (1 - nerves) * 46);
        ay += (dy / dist) * (34 + (1 - nerves) * 46);
        ax += wind.x * 0.16;
        ay += wind.y * 0.1;

        const edge = edgeForce(bug.x, bug.y, Math.min(W, H) * 0.16);
        ax += edge.x * 230;
        ay += edge.y * 230;

        if (bug.dartTimer > 0) {
            ax += Math.cos(bug.dartAngle) * (390 + nerves * 280);
            ay += Math.sin(bug.dartAngle) * (390 + nerves * 280);
            bug.dartTimer -= dt;
        }

        if (bug.startleTimer > 0) {
            ax += Math.cos(bug.dartAngle) * 520;
            ay += Math.sin(bug.dartAngle) * 520;
            bug.startleTimer -= dt;
        }

        bug.vx = (bug.vx + ax * dt) * (0.82 + nerves * 0.08);
        bug.vy = (bug.vy + ay * dt) * (0.82 + nerves * 0.08);

        const maxSpeed = 96 + nerves * 168;
        const speed = Math.hypot(bug.vx, bug.vy);
        if (speed > maxSpeed) {
            bug.vx = bug.vx / speed * maxSpeed;
            bug.vy = bug.vy / speed * maxSpeed;
        }

        bug.x += bug.vx * dt;
        bug.y += bug.vy * dt;
        bug.x = clamp(bug.x, 18, W - 18);
        bug.y = clamp(bug.y, 18, H - 18);
        bug.heading = Math.atan2(bug.vy, bug.vx);
        bug.wing += dt * (28 + nerves * 42);

        if (bug.startleTimer > 0) bug.state = 'Startled';
        else if (bug.dartTimer > 0) bug.state = 'Darting';
        else if (speed < 44) bug.state = 'Hovering';
        else bug.state = dist < 90 ? 'Tasting' : 'Hunting';

        ageTrail(bug.trail, dt);
        pushTrail(bug.trail, bug.x, bug.y, 95);
    }

    function updateLeaf(dt) {
        const chaos = breezeChaos();
        const wind = windAt(leaf.x, leaf.y, time);
        const lag = 0.42 + chaos * 0.52;
        const lift = Math.max(0, wind.gust - 1.25) * (18 + chaos * 36);

        leaf.vx += (wind.x - leaf.vx) * lag * dt;
        leaf.vy += (wind.y * 0.52 - leaf.vy) * lag * dt;
        leaf.vy += (16 - lift) * dt;
        leaf.vx += (fbm(time * 1.7, leaf.x * 0.004, leaf.y * 0.004, 151, 3) - 0.5) * chaos * 56 * dt;
        leaf.vy += (fbm(time * 1.4, leaf.y * 0.005, leaf.x * 0.005, 167, 3) - 0.5) * chaos * 42 * dt;

        const speed = Math.hypot(leaf.vx, leaf.vy);
        if (speed > 128) {
            leaf.vx = leaf.vx / speed * 128;
            leaf.vy = leaf.vy / speed * 128;
        }

        const faceX = Math.cos(leaf.angle);
        const faceY = Math.sin(leaf.angle);
        const cross = faceX * wind.y - faceY * wind.x;
        leaf.av += cross * 0.0009 * (0.7 + chaos) + (fbm(time * 2.1, leaf.x * 0.01, leaf.y * 0.01, 181, 2) - 0.5) * chaos * 2.2 * dt;
        leaf.av *= 0.988;
        leaf.angle += leaf.av * dt + Math.sin(time * 2.4 + leaf.wobble) * 0.004;
        leaf.x += leaf.vx * dt;
        leaf.y += leaf.vy * dt;

        const margin = 54;
        if (leaf.x < -margin) leaf.x = W + margin;
        if (leaf.x > W + margin) leaf.x = -margin;
        if (leaf.y > H + margin) {
            leaf.y = -margin;
            leaf.x = randomRange(W * 0.08, W * 0.72);
            leaf.vx = randomRange(-10, 28);
            leaf.vy = randomRange(8, 26);
            leaf.trail = [];
        }
        if (leaf.y < -margin * 1.8) leaf.y = -margin;

        ageTrail(leaf.trail, dt);
        pushTrail(leaf.trail, leaf.x, leaf.y, 85);
        windPower = lerp(windPower, Math.hypot(wind.x, wind.y) / 100, 0.06);
    }

    function update(dt) {
        time += dt;
        if (disturbance) {
            disturbance.age += dt;
            if (disturbance.age >= disturbance.life) disturbance = null;
        }
        updateBug(dt);
        updateLeaf(dt);
    }

    function drawBackground() {
        ctx.globalCompositeOperation = 'source-over';
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#05070d');
        bg.addColorStop(0.48, '#06100d');
        bg.addColorStop(1, '#030405');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        const glow = ctx.createRadialGradient(W * 0.32, H * 0.3, 0, W * 0.32, H * 0.3, Math.max(W, H) * 0.62);
        glow.addColorStop(0, 'rgba(151,255,174,0.16)');
        glow.addColorStop(0.32, 'rgba(120,240,255,0.055)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);

        const amber = ctx.createRadialGradient(W * 0.82, H * 0.74, 0, W * 0.82, H * 0.74, Math.max(W, H) * 0.48);
        amber.addColorStop(0, 'rgba(255,191,105,0.11)');
        amber.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = amber;
        ctx.fillRect(0, 0, W, H);
    }

    function drawWindLines() {
        const chaos = breezeChaos();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineWidth = 1;
        for (let i = 0; i < 52; i++) {
            const gx = ((i * 97) % 53) / 53;
            const gy = ((i * 43) % 47) / 47;
            const drift = time * (0.035 + chaos * 0.055);
            const x = ((gx + drift * (0.25 + chaos * 0.4)) % 1) * W;
            const y = ((gy + Math.sin(time * 0.23 + i) * 0.016 + 1) % 1) * H;
            const w = windAt(x, y, time);
            const mag = Math.hypot(w.x, w.y);
            if (mag < 0.0001) continue;
            const len = clamp(mag * 0.13, 10, 34);
            const ax = w.x / mag;
            const ay = w.y / mag;
            ctx.strokeStyle = 'rgba(151,255,174,' + (0.035 + chaos * 0.045).toFixed(3) + ')';
            ctx.beginPath();
            ctx.moveTo(x - ax * len * 0.5, y - ay * len * 0.5);
            ctx.lineTo(x + ax * len * 0.5, y + ay * len * 0.5);
            ctx.stroke();
        }
    }

    function drawMotes() {
        ctx.globalCompositeOperation = 'lighter';
        for (const m of motes) {
            const x = ((m.x + time * 0.012 * m.depth + Math.sin(time * 0.8 + m.phase) * 0.004) % 1) * W;
            const y = ((m.y + Math.sin(time * 0.47 + m.phase) * 0.014 + 1) % 1) * H;
            const alpha = (0.08 + 0.18 * m.depth) * (0.55 + 0.45 * Math.sin(time * 1.6 + m.phase));
            ctx.fillStyle = 'rgba(247,238,240,' + Math.max(0, alpha).toFixed(3) + ')';
            ctx.fillRect(x, y, m.size, m.size);
        }
    }

    function drawPlants() {
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineCap = 'round';
        for (const s of stems) {
            const x = s.x * W;
            const h = s.height * H;
            const y0 = H + 4;
            const sway = Math.sin(time * 0.9 + s.phase) * 8 + s.bend * 22;
            ctx.strokeStyle = 'rgba(60,128,78,0.36)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.quadraticCurveTo(x + sway * 0.25, y0 - h * 0.55, x + sway, y0 - h);
            ctx.stroke();
            if (s.bloom) {
                ctx.globalCompositeOperation = 'lighter';
                ctx.fillStyle = 'rgba(255,191,105,0.22)';
                ctx.beginPath();
                ctx.arc(x + sway, y0 - h, 2.4, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalCompositeOperation = 'source-over';
            }
        }
    }

    function drawNectar() {
        ctx.globalCompositeOperation = 'lighter';
        for (const n of nectar) {
            const x = n.x * W;
            const y = n.y * H;
            const pulse = 0.62 + 0.38 * Math.sin(time * 2 + n.pulse);
            const color = n.hue === 'cyan' ? [120, 240, 255] : [255, 191, 105];
            const g = ctx.createRadialGradient(x, y, 0, x, y, n.radius * (2.4 + pulse));
            g.addColorStop(0, 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',0.20)');
            g.addColorStop(1, 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',0)');
            ctx.fillStyle = g;
            ctx.fillRect(x - n.radius * 3, y - n.radius * 3, n.radius * 6, n.radius * 6);
            ctx.fillStyle = 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',0.54)';
            ctx.beginPath();
            ctx.arc(x, y, 2.3 + pulse * 1.2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawTrail(trail, color, width) {
        if (trail.length < 2) return;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = 1; i < trail.length; i++) {
            const a = trail[i - 1];
            const b = trail[i];
            const alpha = clamp(1 - b.age / 2.4, 0, 1);
            ctx.strokeStyle = 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + (alpha * 0.28).toFixed(3) + ')';
            ctx.lineWidth = width * (0.3 + alpha);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
    }

    function drawLeaf() {
        drawTrail(leaf.trail, [255, 191, 105], 2.2);

        ctx.save();
        ctx.translate(leaf.x, leaf.y);
        ctx.rotate(leaf.angle);
        ctx.globalCompositeOperation = 'source-over';
        ctx.shadowColor = 'rgba(255,191,105,0.28)';
        ctx.shadowBlur = 14;

        const body = ctx.createLinearGradient(-18, -24, 18, 28);
        body.addColorStop(0, '#f5c46e');
        body.addColorStop(0.46, '#a3b94f');
        body.addColorStop(1, '#466b38');
        ctx.fillStyle = body;
        ctx.strokeStyle = 'rgba(255,230,168,0.58)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -25);
        ctx.bezierCurveTo(18, -15, 23, 8, 0, 28);
        ctx.bezierCurveTo(-20, 7, -17, -16, 0, -25);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(50,70,28,0.62)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -22);
        ctx.lineTo(0, 24);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255,238,184,0.32)';
        for (let i = -3; i <= 3; i++) {
            if (i === 0) continue;
            const y = i * 6;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(i > 0 ? 11 : -11, y + i * 2.2);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawBug() {
        drawTrail(bug.trail, [255, 45, 166], 2);

        const speed = Math.hypot(bug.vx, bug.vy);
        const angle = Number.isFinite(bug.heading) ? bug.heading : 0;
        const flap = Math.sin(bug.wing);

        ctx.save();
        ctx.translate(bug.x, bug.y);
        ctx.rotate(angle);
        ctx.globalCompositeOperation = 'lighter';
        ctx.shadowColor = 'rgba(255,45,166,0.55)';
        ctx.shadowBlur = 16;

        ctx.fillStyle = 'rgba(120,240,255,0.18)';
        ctx.beginPath();
        ctx.ellipse(-2, -8, 13 + flap * 2, 5, -0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(-2, 8, 13 - flap * 2, 5, 0.55, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255,45,166,0.92)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 7.5, 4.7, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(247,238,240,0.95)';
        ctx.beginPath();
        ctx.arc(6, -2, 1.5, 0, Math.PI * 2);
        ctx.arc(6, 2, 1.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(247,238,240,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(6, -2);
        ctx.quadraticCurveTo(12 + speed * 0.025, -8, 17, -5);
        ctx.moveTo(6, 2);
        ctx.quadraticCurveTo(12 + speed * 0.025, 8, 17, 5);
        ctx.stroke();
        ctx.restore();
    }

    function drawDisturbance() {
        if (!disturbance) return;
        const t = disturbance.age / disturbance.life;
        const radius = lerp(10, 150, t);
        const alpha = 1 - t;
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(120,240,255,' + (alpha * 0.35).toFixed(3) + ')';
        ctx.lineWidth = 1 + alpha * 2;
        ctx.beginPath();
        ctx.arc(disturbance.x, disturbance.y, radius, 0, Math.PI * 2);
        ctx.stroke();
    }

    function drawVignette() {
        ctx.globalCompositeOperation = 'source-over';
        const g = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.24, W * 0.5, H * 0.5, Math.max(W, H) * 0.74);
        g.addColorStop(0, 'rgba(3,4,7,0)');
        g.addColorStop(1, 'rgba(3,4,7,0.72)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    }

    function render() {
        if (!W || !H || !bug || !leaf) return;
        drawBackground();
        drawWindLines();
        drawPlants();
        drawNectar();
        drawMotes();
        drawDisturbance();
        drawLeaf();
        drawBug();
        drawVignette();
    }

    function updateReadouts() {
        if (ui.nervesValue) ui.nervesValue.textContent = String(clamp(num(ui.nerves, 72), 10, 95));
        if (ui.chaosValue) ui.chaosValue.textContent = String(clamp(num(ui.chaos, 58), 5, 95));
        if (ui.bugState) ui.bugState.textContent = bug ? bug.state : 'Hunting';
        if (ui.wind) ui.wind.textContent = fmt(windPower);
        if (ui.leafSpin) ui.leafSpin.textContent = leaf ? fmt(Math.abs(leaf.av)) : '0.00';
        if (ui.startles) ui.startles.textContent = String(startleCount);
        if (ui.status) ui.status.textContent = running ? 'Running' : 'Idle';
        if (ui.toggle) ui.toggle.textContent = running ? 'Pause' : 'Start';
        if (ui.live) ui.live.classList.toggle('is-running', running && visible);
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

    if (ui.toggle) {
        ui.toggle.addEventListener('click', () => {
            running = !running;
            updateReadouts();
            if (running && visible) startLoop();
            else stopLoop();
        });
    }

    if (ui.disturb) ui.disturb.addEventListener('click', disturbRandom);
    if (ui.reset) ui.reset.addEventListener('click', reset);

    if (ui.reroll) {
        ui.reroll.addEventListener('click', () => {
            if (ui.seed) ui.seed.value = Date.now().toString(36).slice(-8);
            reset();
        });
    }

    if (ui.nerves) ui.nerves.addEventListener('input', updateReadouts);
    if (ui.chaos) ui.chaos.addEventListener('input', updateReadouts);

    if (ui.seed) {
        ui.seed.addEventListener('change', reset);
        ui.seed.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                reset();
            }
        });
    }

    canvas.addEventListener('pointerdown', (event) => {
        const rect = canvas.getBoundingClientRect();
        disturbAt(event.clientX - rect.left, event.clientY - rect.top);
    });

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
