// "Invisible Particle Rain" — a simulated cloud chamber.
//
// Charged-particle ionization trails are *modelled* as luminous streaks drifting
// through a supersaturated vapor. This is a visual analogue, not live detector
// data: nothing here is sensed, measured, or identified. Tracks are spawned by a
// stochastic (roughly Poisson) process and drawn as layered glow + core strokes
// that grow, linger, and fade. Pure 2D canvas, no libraries.
//
// Self-contained: mounts on #cloud-chamber-canvas, sizes to its frame, caps DPR,
// honours prefers-reduced-motion, and pauses work when scrolled offscreen.

(function () {
    'use strict';

    const canvas = document.getElementById('cloud-chamber-canvas');
    if (!canvas) return;
    const frame = canvas.parentElement;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const TAU = Math.PI * 2;
    const reduceMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let W = 0, H = 0, dpr = 1;

    // ---- small helpers ----
    const R = (a, b) => a + Math.random() * (b - a);
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

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
        buildVapor();
        if (reduceMotion) renderStill();
    }

    // ============================================================
    //  Background vapor — drifting condensation haze + slow wisps.
    //  Kept very faint so it never veils the tracks.
    // ============================================================
    let wisps = [], motes = [];
    function buildVapor() {
        const wn = W < 640 ? 3 : 4;
        wisps = [];
        for (let i = 0; i < wn; i++) {
            wisps.push({
                x: R(0, W), y: R(0, H),
                r: R(0.28, 0.5) * Math.max(W, H),
                vx: R(-6, 6), vy: R(-3, 3),
                ph: R(0, TAU)
            });
        }
        const mn = W < 640 ? 36 : 70;
        motes = [];
        for (let i = 0; i < mn; i++) {
            motes.push({
                x: R(0, W), y: R(0, H),
                vx: R(-4, 4), vy: R(2, 12),
                s: R(0.4, 1.5), a: R(0.015, 0.05)
            });
        }
    }

    function drawBackground() {
        ctx.globalCompositeOperation = 'source-over'; // self-contained: never inherit 'lighter'
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#070912');
        g.addColorStop(0.55, '#080a14');
        g.addColorStop(1, '#05060d');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    }

    function drawVapor(time, dt) {
        ctx.globalCompositeOperation = 'lighter';
        for (const w of wisps) {
            w.x += w.vx * dt; w.y += w.vy * dt;
            if (w.x < -w.r) w.x = W + w.r; else if (w.x > W + w.r) w.x = -w.r;
            if (w.y < -w.r) w.y = H + w.r; else if (w.y > H + w.r) w.y = -w.r;
            const pulse = 0.5 + 0.5 * Math.sin(time * 0.25 + w.ph);
            const a = 0.012 + 0.018 * pulse;
            const rg = ctx.createRadialGradient(w.x, w.y, 0, w.x, w.y, w.r);
            rg.addColorStop(0, 'rgba(60,86,140,' + a.toFixed(3) + ')');
            rg.addColorStop(1, 'rgba(40,60,110,0)');
            ctx.fillStyle = rg;
            ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, TAU); ctx.fill();
        }
        for (const m of motes) {
            m.x += m.vx * dt; m.y += m.vy * dt;
            if (m.y > H + 4) { m.y = -4; m.x = R(0, W); }
            if (m.x < -4) m.x = W + 4; else if (m.x > W + 4) m.x = -4;
            ctx.fillStyle = 'rgba(150,180,225,' + m.a.toFixed(3) + ')';
            ctx.fillRect(m.x, m.y, m.s, m.s);
        }
    }

    // ============================================================
    //  Track geometry
    // ============================================================
    // A track is one or more polyline "segments" (the primary plus any branches).
    // Each segment carries cumulative arc-lengths so the trail can be revealed
    // progressively as the simulated particle traverses it.

    function buildSegment(x, y, angle, stepLen, steps, jitter, kink, delay, growth) {
        const pts = [{ x, y }];
        let a = angle;
        const margin = Math.max(W, H) * 0.25;
        for (let i = 0; i < steps; i++) {
            a += R(-jitter, jitter);
            if (kink && Math.random() < kink) a += R(-0.9, 0.9); // occasional sharp scatter
            x += Math.cos(a) * stepLen;
            y += Math.sin(a) * stepLen;
            pts.push({ x, y });
            if (x < -margin || x > W + margin || y < -margin || y > H + margin) break;
        }
        const cum = [0];
        for (let i = 1; i < pts.length; i++) {
            cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        }
        return { pts, cum, total: cum[cum.length - 1], delay, growth };
    }

    function edgeStart() {
        // a point on the chamber perimeter and an angle aimed roughly across it
        const side = Math.floor(R(0, 4));
        let x, y, base;
        if (side === 0) { x = R(0, W); y = -4; base = R(0.15, 0.85) * Math.PI; }            // top -> down
        else if (side === 1) { x = W + 4; y = R(0, H); base = R(0.65, 1.35) * Math.PI; }     // right -> left
        else if (side === 2) { x = R(0, W); y = H + 4; base = R(1.15, 1.85) * Math.PI; }     // bottom -> up
        else { x = -4; y = R(0, H); base = R(-0.35, 0.35) * Math.PI; }                       // left -> right
        return { x, y, angle: base };
    }

    function makeTrack(type) {
        const diag = Math.hypot(W, H);
        const t = { type, age: 0, segments: [] };

        if (type === 'muonLike') {
            // long, thin, near-straight; crosses a large part of the chamber.
            const s = edgeStart();
            const stepLen = 16;
            const steps = Math.ceil((diag * R(0.8, 1.15)) / stepLen);
            t.segments.push(buildSegment(s.x, s.y, s.angle, stepLen, steps, 0.012, 0, 0, 0.16));
            t.core = [205, 226, 255]; t.glow = [110, 158, 255];
            t.width = R(1.0, 1.4); t.grain = false;
            t.intensity = R(0.7, 0.95); t.growth = 0.16; t.tau = 0.55;

        } else if (type === 'betaLike') {
            // medium, thinner, wandering/kinked — more chaotic than a muon.
            const fromEdge = Math.random() < 0.6;
            const s = fromEdge ? edgeStart() : { x: R(0.2, 0.8) * W, y: R(0.2, 0.8) * H, angle: R(0, TAU) };
            const stepLen = 9;
            const steps = Math.ceil((diag * R(0.28, 0.5)) / stepLen);
            t.segments.push(buildSegment(s.x, s.y, s.angle, stepLen, steps, 0.14, 0.06, 0, 0.22));
            t.core = [196, 220, 255]; t.glow = [96, 150, 240];
            t.width = R(0.7, 1.0); t.grain = false;
            t.intensity = R(0.55, 0.8); t.growth = 0.22; t.tau = 0.85;

        } else if (type === 'alphaLike') {
            // short, thick, dense, textured; fades slowly.
            const x = R(0.2, 0.8) * W, y = R(0.2, 0.8) * H, angle = R(0, TAU);
            const stepLen = 6;
            const steps = Math.ceil((diag * R(0.06, 0.13)) / stepLen);
            t.segments.push(buildSegment(x, y, angle, stepLen, steps, 0.05, 0, 0, 0.1));
            t.core = [236, 246, 255]; t.glow = [150, 196, 255];
            t.width = R(2.6, 3.8); t.grain = true;
            t.intensity = R(0.85, 1.0); t.growth = 0.1; t.tau = 2.4;

        } else { // shower
            // a primary streak that branches into a few smaller tracks.
            const s = edgeStart();
            const stepLen = 14;
            const steps = Math.ceil((diag * R(0.4, 0.7)) / stepLen);
            const mainGrowth = 0.2;
            const main = buildSegment(s.x, s.y, s.angle, stepLen, steps, 0.02, 0, 0, mainGrowth);
            t.segments.push(main);
            const bi = Math.floor(main.pts.length * R(0.45, 0.7));
            const v = main.pts[Math.min(bi, main.pts.length - 1)];
            const branchAngle = Math.atan2(
                v.y - main.pts[Math.max(0, bi - 1)].y,
                v.x - main.pts[Math.max(0, bi - 1)].x
            );
            // branches start revealing once the primary's head reaches the vertex
            const branchDelay = main.cum[Math.min(bi, main.cum.length - 1)] / main.total * mainGrowth;
            const nb = Math.floor(R(2, 5));
            for (let k = 0; k < nb; k++) {
                const ba = branchAngle + R(-0.8, 0.8);
                const bsteps = Math.ceil((diag * R(0.12, 0.3)) / 9);
                t.segments.push(buildSegment(v.x, v.y, ba, 9, bsteps, 0.12, 0.05, branchDelay, 0.3));
            }
            t.core = [212, 230, 255]; t.glow = [120, 168, 255];
            t.width = R(1.1, 1.5); t.grain = false;
            t.intensity = R(0.7, 0.95); t.growth = 0.2; t.tau = 1.0;
        }

        // lifetime: long enough for the brightness envelope to decay to ~1%.
        let maxDelay = 0;
        for (const seg of t.segments) maxDelay = Math.max(maxDelay, seg.delay + seg.growth);
        t.lifetime = maxDelay + t.tau * 4.6;
        return t;
    }

    // brightness envelope: ramp up over `growth`, then exponential decay over `tau`.
    function envelope(t) {
        if (t.age < t.growth) return (t.age / t.growth) * t.intensity;
        return Math.exp(-(t.age - t.growth) / t.tau) * t.intensity;
    }

    function strokePath(seg, revealLen) {
        if (revealLen <= 0) return;
        const { pts, cum } = seg;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            if (cum[i] <= revealLen) {
                ctx.lineTo(pts[i].x, pts[i].y);
            } else {
                const span = cum[i] - cum[i - 1] || 1;
                const f = (revealLen - cum[i - 1]) / span;
                ctx.lineTo(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
                           pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f);
                break;
            }
        }
        ctx.stroke();
    }

    function drawTrack(t) {
        const env = envelope(t);
        if (env <= 0.004) return;
        const cr = t.core, gl = t.glow;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (const seg of t.segments) {
            const localAge = t.age - seg.delay;
            if (localAge <= 0) continue;
            const reveal = seg.total * clamp(localAge / seg.growth, 0, 1);

            // broad soft glow underlay
            ctx.strokeStyle = 'rgba(' + gl[0] + ',' + gl[1] + ',' + gl[2] + ',' +
                (env * 0.22).toFixed(3) + ')';
            ctx.lineWidth = t.width * 4.5;
            strokePath(seg, reveal);

            // mid halo
            ctx.strokeStyle = 'rgba(' + gl[0] + ',' + gl[1] + ',' + gl[2] + ',' +
                (env * 0.4).toFixed(3) + ')';
            ctx.lineWidth = t.width * 2.1;
            strokePath(seg, reveal);

            // bright core
            ctx.strokeStyle = 'rgba(' + cr[0] + ',' + cr[1] + ',' + cr[2] + ',' +
                Math.min(0.95, env).toFixed(3) + ')';
            ctx.lineWidth = t.width;
            strokePath(seg, reveal);

            // condensation grain for dense (alpha-like) trails
            if (t.grain) {
                const { pts, cum } = seg;
                for (let i = 0; i < pts.length; i++) {
                    if (cum[i] > reveal) break;
                    const a = env * (0.45 + Math.random() * 0.45);
                    ctx.fillStyle = 'rgba(244,250,255,' + a.toFixed(3) + ')';
                    const sz = R(0.8, 2.0);
                    ctx.fillRect(pts[i].x + R(-1.4, 1.4) - sz / 2,
                                 pts[i].y + R(-1.4, 1.4) - sz / 2, sz, sz);
                }
            }
        }
    }

    function vignette() {
        ctx.globalCompositeOperation = 'source-over';
        const cx = W / 2, cy = H / 2;
        const g = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.25, cx, cy, Math.max(W, H) * 0.7);
        g.addColorStop(0, 'rgba(5,6,13,0)');
        g.addColorStop(1, 'rgba(3,4,10,0.6)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    }

    // ============================================================
    //  Spawning — stochastic (exponential inter-arrival ≈ Poisson)
    // ============================================================
    const tracks = [];
    const SPAWN_RATE = 1.7;          // mean tracks per second
    let nextSpawn = -Math.log(Math.random()) / SPAWN_RATE;
    let spawnAcc = 0;

    function chooseType() {
        const r = Math.random();
        if (r < 0.42) return 'muonLike';   // common
        if (r < 0.82) return 'betaLike';   // common
        if (r < 0.97) return 'alphaLike';  // occasional
        return 'shower';                   // rare
    }

    function spawn() {
        if (W < 2 || H < 2) return;
        tracks.push(makeTrack(chooseType()));
        if (tracks.length > 70) tracks.splice(0, tracks.length - 70);
    }

    // ============================================================
    //  Reduced-motion still: a calm, fixed composition, no loop.
    // ============================================================
    function renderStill() {
        drawBackground();
        drawVapor(0, 0);
        // A representative frozen frame: every archetype shown, fully traced and
        // near peak brightness, with a little age spread so it reads as depth
        // rather than a uniform burst. This is the entire experience for
        // reduced-motion users, so it should be rich and self-explanatory.
        const sample = ['muonLike', 'muonLike', 'betaLike', 'betaLike',
                        'betaLike', 'alphaLike', 'alphaLike', 'shower'];
        for (const ty of sample) {
            const t = makeTrack(ty);
            t.age = t.growth + t.tau * R(0, 0.35); // fully revealed, bright, slight spread
            drawTrack(t);
        }
        vignette();
    }

    // ============================================================
    //  Main loop
    // ============================================================
    let last = performance.now();
    // Default to running so the animation works even if IntersectionObserver
    // never fires; IO then only *pauses* it while the chamber is scrolled away.
    let running = true;
    let visible = !document.hidden;
    let rafId = 0;

    function frameStep(now) {
        // Genuinely halt when inactive so the browser can throttle — no phantom
        // frames. startLoop() resumes from the visibility/intersection handlers.
        if (!(running && visible)) { rafId = 0; return; }
        rafId = requestAnimationFrame(frameStep);

        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        const time = now / 1000;

        spawnAcc += dt;
        while (spawnAcc >= nextSpawn) {
            spawnAcc -= nextSpawn;
            spawn();
            nextSpawn = -Math.log(Math.random() || 1e-9) / SPAWN_RATE;
        }

        for (let i = tracks.length - 1; i >= 0; i--) {
            tracks[i].age += dt;
            if (tracks[i].age > tracks[i].lifetime) tracks.splice(i, 1);
        }

        drawBackground();
        drawVapor(time, dt);
        for (const t of tracks) drawTrack(t);
        vignette();
    }

    function startLoop() {
        if (rafId) return;
        last = performance.now();
        rafId = requestAnimationFrame(frameStep);
    }
    function stopLoop() {
        if (!rafId) return;
        cancelAnimationFrame(rafId);
        rafId = 0;
    }

    // ---- wiring ----
    resize();

    if ('ResizeObserver' in window) {
        const ro = new ResizeObserver(() => resize());
        ro.observe(frame);
    } else {
        window.addEventListener('resize', resize);
    }

    if (reduceMotion) {
        renderStill();
        return; // no animation loop at all
    }

    document.addEventListener('visibilitychange', () => {
        visible = !document.hidden;
        if (visible && running) startLoop(); else stopLoop();
    });

    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            // pause when the chamber is scrolled out of view, resume when back
            running = entries.some(e => e.isIntersecting);
            if (running && visible) startLoop(); else stopLoop();
        }, { threshold: 0, rootMargin: '120px' });
        io.observe(frame);
    }

    startLoop();
})();
