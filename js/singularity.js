// Interactive gravitationally-lensed black hole.
// A dense stream of particles on Keplerian orbits forms the accretion disk; the
// shadow is simply the region the particles avoid (no drawn placeholder object),
// deepened by a soft, edgeless darkening. A faint rippling gas field sits under
// the particles, and the far side of the disk is lensed up over the top. The view
// is interactive: moving the pointer orbits the inclination and shifts the Doppler
// side; clicking drops infalling flares. Pure 2D canvas — stylized, not a geodesic
// solver.

(function () {
    'use strict';

    let canvas = document.getElementById('singularity-bg');
    if (!canvas) {
        // Self-mount the background canvas (matches the previous module's behaviour).
        canvas = document.createElement('canvas');
        canvas.id = 'singularity-bg';
        document.body.prepend(canvas);
    }
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const TAU = Math.PI * 2;
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, S = 0;
    let R = 0;                 // shadow radius, px
    let t0 = performance.now();

    // ---- interaction state (eased toward targets) ----
    const ptr = {
        inc: 1.02, incT: 1.02,        // viewing inclination (rad): small=face-on, ~1.4=edge-on
        px: 0, pxT: 0,                // horizontal parallax offset (px)
        py: 0, pyT: 0,                // vertical parallax offset (px)
        dop: 0, dopT: 0,             // extra Doppler bias from cursor x
        flare: 0                     // click flare envelope (0..1, decays)
    };

    // ---- deterministic RNG (seeded; no Math.random for reproducibility) ----
    let _s = 0x2545F491;
    function rnd() { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 0xFFFFFFFF); }

    // disk geometry in units of R
    const INNER_U = 1.28, OUTER_U = 7.8;

    // ---- particle disk ----
    let particles = [];
    function buildParticles() {
        // +50% density over the prior 1100 / 1800 / 2600 tiers
        const n = W < 700 ? 1650 : (W < 1300 ? 2700 : 3900);
        particles = new Array(n);
        for (let i = 0; i < n; i++) particles[i] = spawnParticle(true);
    }
    function spawnParticle(initial) {
        // bias density toward the hot inner edge
        const ru = Math.pow(rnd(), 1.7);                 // 0 = inner, 1 = outer
        return {
            ru,
            a: rnd() * TAU,
            jitter: 0.85 + rnd() * 0.3,                  // per-particle speed variation
            thick: rnd(),                                // size variation
            // when not the initial fill, start at the outer rim (fresh infall)
            _fresh: !initial
        };
    }

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cx = W * 0.5; cy = H * 0.5;
        S = Math.min(W, H);
        R = Math.max(34, S * 0.10);
        if (!particles.length) buildParticles();
    }
    resize();
    window.addEventListener('resize', resize);

    // ---- starfield ----
    const stars = [];
    for (let i = 0; i < 260; i++) stars.push({ fx: rnd(), fy: rnd(), r: rnd() * 1.2 + 0.2, tw: rnd() * TAU, sp: 0.4 + rnd() });

    // ---- temperature ramp (cool outer -> hot inner) ----
    const RAMP = [
        [70, 18, 95],     // deep violet
        [180, 28, 120],   // magenta
        [255, 58, 62],    // red
        [255, 126, 48],   // orange
        [255, 198, 112],  // amber
        [255, 244, 224]   // white-hot
    ];
    function temp(u) { // u in [0,1], 1 = hottest
        u = u < 0 ? 0 : u > 0.999 ? 0.999 : u;
        const x = u * (RAMP.length - 1), i = x | 0, f = x - i, a = RAMP[i], b = RAMP[i + 1] || a;
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }

    // smooth pseudo-noise (sum of sines, seamless in theta)
    function turb(theta, ring, time) {
        return 0.5
            + 0.30 * Math.sin(theta * 3 + ring * 1.7 + time * 0.6)
            + 0.18 * Math.sin(theta * 7 - ring * 0.9 - time * 0.9)
            + 0.12 * Math.sin(theta * 13 + ring * 2.3 + time * 1.4);
    }

    // far-side lensing lift: how far the back of the disk bends up over the shadow
    function liftAt(rr) { return R * 1.3 * Math.exp(-(rr - R * INNER_U) / (R * 1.7)); }

    // ---- pointer / interaction ----
    function onMove(clientX, clientY) {
        const mx = clientX / W, my = clientY / H;
        ptr.incT = 0.45 + my * 0.92;                        // top: face-on, bottom: edge-on
        ptr.pxT = (mx - 0.5) * R * 0.9;
        ptr.pyT = (my - 0.5) * R * 0.4;
        ptr.dopT = (mx - 0.5) * 0.6;
    }
    window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY), { passive: true });
    window.addEventListener('touchmove', e => { if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });

    const flares = [];
    function spawnFlare() {
        const ang = rnd() * TAU, r = R * (6.5 + rnd() * 2);
        flares.push({ ang, r, r0: r, life: 1 });
    }
    window.addEventListener('pointerdown', () => { ptr.flare = 1; spawnFlare(); spawnFlare(); }, { passive: true });

    // ---- perspective grid floor (retrocyber) ----
    function drawGrid(time) {
        const horizon = cy + S * 0.10;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = 1;
        const drift = (time * 0.06) % 1;
        for (let i = 0; i < 16; i++) {
            const f = (i + drift) / 16;
            const y = horizon + Math.pow(f, 2.2) * (H - horizon) * 1.1;
            if (y > H) continue;
            const a = 0.09 * (1 - f);
            ctx.strokeStyle = 'rgba(255,60,120,' + a.toFixed(3) + ')';
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        const vp = cx + ptr.px * 0.5;
        for (let i = -10; i <= 10; i++) {
            const x = vp + i * (W / 14);
            const a = 0.06 * (1 - Math.abs(i) / 11);
            ctx.strokeStyle = 'rgba(255,60,120,' + a.toFixed(3) + ')';
            ctx.beginPath(); ctx.moveTo(vp + i * 8, horizon); ctx.lineTo(x, H); ctx.stroke();
        }
        ctx.restore();
    }

    function drawStars(time) {
        ctx.globalCompositeOperation = 'lighter';
        for (const s of stars) {
            const tw = 0.4 + 0.6 * Math.abs(Math.sin(s.tw + time * s.sp));
            ctx.fillStyle = 'rgba(255,210,220,' + (tw * 0.5 * s.r).toFixed(3) + ')';
            ctx.fillRect(s.fx * W + ptr.px * 0.15, s.fy * H + ptr.py * 0.15, s.r, s.r);
        }
    }

    // ---- faint gas field (the rippling waves), drawn as thin arcs ----
    function drawGasHalf(near, time) {
        const yscale = Math.cos(ptr.inc);
        const inner = R * 1.3, outer = R * OUTER_U;
        const rings = W < 700 ? 22 : 34;
        const segs = W < 700 ? 56 : 88;
        const bx = cx + ptr.px, by = cy + ptr.py;
        const flareBoost = 1 + ptr.flare * 0.6;
        ctx.globalCompositeOperation = 'lighter';

        for (let ri = 0; ri < rings; ri++) {
            const fr = ri / (rings - 1);
            const r = inner + (outer - inner) * fr * fr;
            const u = 1 - fr;
            const col = temp(u * 0.85 + 0.1);
            const lift = liftAt(r);
            const baseA = (0.018 + 0.07 * u) * flareBoost;      // fainter than before — particles carry the disk now
            ctx.lineWidth = (near ? 1.6 : 1.3) + u * 1.6;
            ctx.beginPath();
            let started = false;
            for (let si = 0; si <= segs; si++) {
                const th = (si / segs) * TAU;
                const sinT = Math.sin(th), cosT = Math.cos(th);
                if ((sinT >= 0) !== near) { started = false; continue; }
                const tj = 1 + 0.05 * (turb(th, ri, time) - 0.5) * 2;
                const rr = r * tj;
                const x = bx + cosT * rr;
                let y = by + sinT * rr * yscale;
                if (!near) y -= lift * (-sinT);
                if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
            }
            const tBright = 0.6 + 0.4 * turb(time * 0.7, ri, time);
            const a = baseA * tBright;
            ctx.strokeStyle = 'rgba(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ',' + Math.min(0.6, a).toFixed(3) + ')';
            ctx.stroke();
        }
    }

    // ---- the particle disk (dense flowing streaks) ----
    // near=true draws the front band (occludes the hole's lower edge); near=false
    // draws the back, lensed up over the top.
    function drawParticles(near, time, dt) {
        const yscale = Math.cos(ptr.inc);
        const inner = R * INNER_U, outer = R * OUTER_U;
        const span = outer - inner;
        const bx = cx + ptr.px, by = cy + ptr.py;
        const flareBoost = 1 + ptr.flare * 1.1;
        const dopBias = ptr.dop;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const rr = inner + span * p.ru;
            // Keplerian angular speed (faster inner); only advance/age on the near
            // pass so each particle integrates exactly once per frame.
            const omega = 1.9 / Math.pow(rr / R, 1.5) * p.jitter;
            if (near) {
                p.a += omega * dt;
                p.ru -= dt * 0.018 * (1.2 - p.ru);          // slow inward spiral
                if (p.ru <= 0) { const np = spawnParticle(false); np.ru = 0.92 + rnd() * 0.08; particles[i] = np; continue; }
            }
            const sinA = Math.sin(p.a), cosA = Math.cos(p.a);
            if ((sinA >= 0) !== near) continue;             // this pass only draws its half

            const x = bx + cosA * rr;
            let y = by + sinA * rr * yscale;
            if (!near) y -= liftAt(rr) * (-sinA);           // lens the back up over the top

            // tangential velocity direction (screen space) for the motion-blur streak
            let vx = -sinA, vy = cosA * yscale;
            const vlen = Math.hypot(vx, vy) || 1; vx /= vlen; vy /= vlen;

            const u = 1 - p.ru;                              // 1 = hot inner
            const speed = omega * rr;
            const trail = Math.min(R * 0.16, 1.5 + speed * 0.05);

            // proximity to the singularity: 0 at the rim, 1 at the inner edge,
            // ramped non-linearly so the glow surges as material falls inward
            // (mimics the steep rise in temperature/intensity near the hole).
            const prox = u * u * (3 - 2 * u);                // smoothstep(u)
            const glow = 0.35 + 2.6 * prox * prox;           // intensity multiplier

            // relativistic Doppler beaming: the limb coming toward the viewer (here
            // mapped to the left, vx<0) brightens; cursor adds a bias.
            const beam = 1 + 1.4 * (-vx) + dopBias * 1.2;
            const bright = Math.max(0.15, beam) * flareBoost * glow;

            const col = temp(u * 0.9 + 0.08);
            // hot inner material washes toward white as it brightens
            const wash = Math.min(1, (prox * 0.7 + (beam - 1) * 0.35));
            const r8 = (col[0] + (255 - col[0]) * wash) | 0;
            const g8 = (col[1] + (255 - col[1]) * wash) | 0;
            const b8 = (col[2] + (255 - col[2]) * wash) | 0;
            const a = Math.min(0.9, (0.045 + 0.13 * u) * bright);

            // soft glow halo, intensifying toward the singularity — a wider, faint
            // underlay stroke so close-in particles bloom
            if (prox > 0.12) {
                ctx.strokeStyle = 'rgba(' + r8 + ',' + g8 + ',' + b8 + ',' + Math.min(0.4, a * 0.45 * prox).toFixed(3) + ')';
                ctx.lineWidth = (0.6 + p.thick * 1.3 + u * 1.2) + 2.5 + prox * 5.5;
                ctx.beginPath();
                ctx.moveTo(x - vx * trail, y - vy * trail);
                ctx.lineTo(x, y);
                ctx.stroke();
            }

            ctx.strokeStyle = 'rgba(' + r8 + ',' + g8 + ',' + b8 + ',' + a.toFixed(3) + ')';
            ctx.lineWidth = 0.6 + p.thick * 1.3 + u * 1.2;
            ctx.beginPath();
            ctx.moveTo(x - vx * trail, y - vy * trail);
            ctx.lineTo(x, y);
            ctx.stroke();

            // bright white-hot head for the closest, fastest particles
            if (prox > 0.4) {
                ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.85, a * 1.1).toFixed(3) + ')';
                const hs = 0.6 + prox * 1.4;
                ctx.fillRect(x - hs * 0.5, y - hs * 0.5, hs, hs);
            }
        }
    }

    // ---- soft, edgeless void (no hard outline / placeholder object) ----
    function drawVoid() {
        const bx = cx + ptr.px, by = cy + ptr.py;
        ctx.globalCompositeOperation = 'source-over';
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, R * 1.16);
        g.addColorStop(0, 'rgba(3,2,6,0.97)');
        g.addColorStop(0.55, 'rgba(4,3,7,0.92)');
        g.addColorStop(0.82, 'rgba(5,4,9,0.45)');
        g.addColorStop(1, 'rgba(6,4,9,0)');               // fades fully -> no rim
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(bx, by, R * 1.3, 0, TAU); ctx.fill();
    }

    function drawFlares(time, dt) {
        const bx = cx + ptr.px, by = cy + ptr.py;
        const yscale = Math.cos(ptr.inc);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = flares.length - 1; i >= 0; i--) {
            const f = flares[i];
            f.r -= dt * R * 1.4; f.ang += dt * 1.6; f.life -= dt * 0.5;
            if (f.r <= R * 1.2 || f.life <= 0) { flares.splice(i, 1); continue; }
            const x = bx + Math.cos(f.ang) * f.r;
            const y = by + Math.sin(f.ang) * f.r * yscale;
            const a = f.life * 0.7;
            const g = ctx.createRadialGradient(x, y, 0, x, y, R * 0.6);
            g.addColorStop(0, 'rgba(255,250,235,' + a.toFixed(3) + ')');
            g.addColorStop(1, 'rgba(255,90,70,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 0.6, 0, TAU); ctx.fill();
        }
    }

    function vignette() {
        ctx.globalCompositeOperation = 'source-over';
        const g = ctx.createRadialGradient(cx, cy, S * 0.25, cx, cy, S * 0.85);
        g.addColorStop(0, 'rgba(7,5,10,0)');
        g.addColorStop(1, 'rgba(4,2,7,0.72)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    // ---- main loop ----
    let last = performance.now(), running = true, flareAcc = 0;
    document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) last = performance.now(); });

    function ease(cur, tgt, k, dt) { return cur + (tgt - cur) * (1 - Math.exp(-k * dt)); }

    function frame(now) {
        if (running) {
            const dt = Math.min((now - last) / 1000, 0.05); last = now;
            const time = (now - t0) / 1000;

            ptr.inc = ease(ptr.inc, ptr.incT, 4, dt);
            ptr.px = ease(ptr.px, ptr.pxT, 5, dt);
            ptr.py = ease(ptr.py, ptr.pyT, 5, dt);
            ptr.dop = ease(ptr.dop, ptr.dopT, 4, dt);
            ptr.flare = Math.max(0, ptr.flare - dt * 1.3);

            if (!reduceMotion) { flareAcc += dt; if (flareAcc > 3.2) { flareAcc = 0; spawnFlare(); } }

            // base wipe (full clear — no smear so streaks stay crisp)
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = 'rgb(6,4,9)';
            ctx.fillRect(0, 0, W, H);

            drawGrid(time);
            drawStars(time);

            // back of disk (behind / lensed over the top)
            drawGasHalf(false, time);
            drawParticles(false, time, dt);

            // the hole itself — soft, no drawn outline
            drawVoid();

            // front of disk (in front of the hole's lower edge)
            drawGasHalf(true, time);
            drawParticles(true, time, dt);

            drawFlares(time, dt);
            vignette();
        } else {
            last = now;
        }
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
})();
