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
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;

    const TAU = Math.PI * 2;
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const hasTouch = navigator.maxTouchPoints && navigator.maxTouchPoints > 0;

    let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, S = 0;
    let R = 0;                 // shadow radius, px
    let t0 = performance.now();
    let vignetteGradient = null;

    const perf = {
        mobile: false,
        dprCap: 1.6,
        particleCount: 1800,
        starCount: 220,
        gasRings: 30,
        gasSegs: 76,
        gridRows: 14,
        gridCols: 9,
        fps: 60,
        glowMin: 0.12,
        headMin: 0.4,
        strokeScale: 1,
        lensArcLimit: 90
    };

    function configurePerformance() {
        const shortSide = Math.min(W, H);
        const area = W * H;
        perf.mobile = shortSide < 520 || ((coarsePointer || hasTouch) && shortSide < 820);
        perf.dprCap = perf.mobile ? 1.15 : (shortSide < 760 ? 1.35 : 1.7);
        perf.fps = reduceMotion ? 24 : (perf.mobile ? 42 : 60);

        if (perf.mobile) {
            perf.particleCount = reduceMotion ? 360 : 760;
            perf.starCount = 150;
            perf.gasRings = 14;
            perf.gasSegs = 42;
            perf.gridRows = 9;
            perf.gridCols = 6;
            perf.glowMin = 0.34;
            perf.headMin = 0.58;
            perf.strokeScale = 0.9;
            perf.lensArcLimit = 44;
        } else if (area < 720000) {
            perf.particleCount = reduceMotion ? 520 : 1200;
            perf.starCount = 190;
            perf.gasRings = 20;
            perf.gasSegs = 56;
            perf.gridRows = 12;
            perf.gridCols = 8;
            perf.glowMin = 0.2;
            perf.headMin = 0.48;
            perf.strokeScale = 0.95;
            perf.lensArcLimit = 64;
        } else if (W < 1300) {
            perf.particleCount = reduceMotion ? 780 : 2100;
            perf.starCount = 230;
            perf.gasRings = 28;
            perf.gasSegs = 72;
            perf.gridRows = 14;
            perf.gridCols = 9;
            perf.glowMin = 0.14;
            perf.headMin = 0.43;
            perf.strokeScale = 1;
            perf.lensArcLimit = 80;
        } else {
            perf.particleCount = reduceMotion ? 1000 : 3000;
            perf.starCount = 260;
            perf.gasRings = 34;
            perf.gasSegs = 88;
            perf.gridRows = 16;
            perf.gridCols = 10;
            perf.glowMin = 0.12;
            perf.headMin = 0.4;
            perf.strokeScale = 1;
            perf.lensArcLimit = 96;
        }
    }

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
    let particleId = 0;
    const frontParticles = [];
    const backParticles = [];

    function buildParticles() {
        const n = perf.particleCount;
        particles = new Array(n);
        for (let i = 0; i < n; i++) particles[i] = spawnParticle(true);
    }

    function tuneParticleCount() {
        const n = perf.particleCount;
        if (!particles.length) {
            buildParticles();
            return;
        }
        if (particles.length > n) {
            particles.length = n;
            return;
        }
        while (particles.length < n) particles.push(spawnParticle(true));
    }

    function spawnParticle(initial) {
        // bias density toward the hot inner edge
        const ru = Math.pow(rnd(), 1.7);                 // 0 = inner, 1 = outer
        return {
            id: particleId++,
            ru,
            a: rnd() * TAU,
            jitter: 0.85 + rnd() * 0.3,                  // per-particle speed variation
            thick: rnd(),                                // size variation
            x: 0, y: 0, vx: 0, vy: 0, u: 0, prox: 0, trail: 0,
            // when not the initial fill, start at the outer rim (fresh infall)
            _fresh: !initial
        };
    }

    function resize() {
        W = window.innerWidth; H = window.innerHeight;
        configurePerformance();
        dpr = Math.min(window.devicePixelRatio || 1, perf.dprCap);
        const nextW = Math.round(W * dpr);
        const nextH = Math.round(H * dpr);
        if (canvas.width !== nextW) canvas.width = nextW;
        if (canvas.height !== nextH) canvas.height = nextH;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;
        cx = W * 0.5; cy = H * 0.5;
        S = Math.min(W, H);
        R = Math.max(34, S * 0.10);
        vignetteGradient = ctx.createRadialGradient(cx, cy, S * 0.25, cx, cy, S * 0.85);
        vignetteGradient.addColorStop(0, 'rgba(7,5,10,0)');
        vignetteGradient.addColorStop(1, 'rgba(4,2,7,0.72)');
        tuneParticleCount();
    }
    resize();
    let resizeRaf = 0;
    window.addEventListener('resize', () => {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0;
            resize();
        });
    });

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
        for (let i = 0; i < perf.gridRows; i++) {
            const f = (i + drift) / perf.gridRows;
            const y = horizon + Math.pow(f, 2.2) * (H - horizon) * 1.1;
            if (y > H) continue;
            const a = 0.09 * (1 - f);
            ctx.strokeStyle = 'rgba(255,60,120,' + a.toFixed(3) + ')';
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        const vp = cx + ptr.px * 0.5;
        for (let i = -perf.gridCols; i <= perf.gridCols; i++) {
            const x = vp + i * (W / (perf.gridCols + 4));
            const a = 0.06 * (1 - Math.abs(i) / (perf.gridCols + 1));
            ctx.strokeStyle = 'rgba(255,60,120,' + a.toFixed(3) + ')';
            ctx.beginPath(); ctx.moveTo(vp + i * 8, horizon); ctx.lineTo(x, H); ctx.stroke();
        }
        ctx.restore();
    }

    function drawStars(time) {
        const bx = cx + ptr.px, by = cy + ptr.py;
        const lensOuter = R * (perf.mobile ? 4.4 : 5.2);
        const ringR = R * 1.55;
        const ringWidth = R * 0.92;
        const count = Math.min(stars.length, perf.starCount);
        let arcsDrawn = 0;

        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (let i = 0; i < count; i++) {
            const s = stars[i];
            const tw = 0.4 + 0.6 * Math.abs(Math.sin(s.tw + time * s.sp));
            const baseA = tw * 0.5 * s.r;
            const sx = s.fx * W + ptr.px * 0.15;
            const sy = s.fy * H + ptr.py * 0.15;
            const dx = sx - bx, dy = sy - by;
            const dist = Math.hypot(dx, dy) || 1;

            if (dist < lensOuter && dist > R * 0.8) {
                const inv = 1 / dist;
                const nx = dx * inv, ny = dy * inv;
                const bend = 1 - dist / lensOuter;
                const ring = Math.exp(-Math.pow((dist - ringR) / ringWidth, 2));
                const shift = R * (0.18 * bend * bend + 0.56 * ring * bend);
                const lx = sx + nx * shift;
                const ly = sy + ny * shift;
                const a = Math.min(0.72, baseA * (0.8 + ring * 1.7));

                if (ring > 0.13 && arcsDrawn < perf.lensArcLimit) {
                    const angle = Math.atan2(dy, dx);
                    const arcRadius = Math.max(R * 1.32, dist + shift * 0.35);
                    const arcLen = (0.03 + ring * 0.17) * (perf.mobile ? 0.74 : 1);
                    ctx.strokeStyle = 'rgba(255,226,238,' + Math.min(0.55, a * 0.8).toFixed(3) + ')';
                    ctx.lineWidth = Math.max(0.55, s.r * (1.2 + ring * 2.2));
                    ctx.beginPath();
                    ctx.arc(bx, by, arcRadius, angle - arcLen, angle + arcLen);
                    ctx.stroke();
                    arcsDrawn++;

                    if (!perf.mobile && ring > 0.42 && arcsDrawn < perf.lensArcLimit) {
                        ctx.strokeStyle = 'rgba(255,130,180,' + Math.min(0.22, a * 0.36).toFixed(3) + ')';
                        ctx.lineWidth = Math.max(0.5, s.r * 1.1);
                        ctx.beginPath();
                        ctx.arc(bx, by, R * 1.42, angle + Math.PI - arcLen * 0.7, angle + Math.PI + arcLen * 0.7);
                        ctx.stroke();
                        arcsDrawn++;
                    }
                }

                ctx.fillStyle = 'rgba(255,222,234,' + a.toFixed(3) + ')';
                ctx.fillRect(lx, ly, s.r, s.r);
                continue;
            }

            ctx.fillStyle = 'rgba(255,210,220,' + baseA.toFixed(3) + ')';
            ctx.fillRect(sx, sy, s.r, s.r);
        }
    }

    // ---- faint gas field (the rippling waves), drawn as thin arcs ----
    function drawGasHalf(near, time) {
        const yscale = Math.cos(ptr.inc);
        const inner = R * 1.3, outer = R * OUTER_U;
        const rings = perf.gasRings;
        const segs = perf.gasSegs;
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
    // Particles are integrated/projected once per frame, then drawn in two lists so
    // the back half can sit behind the shadow and the front half can cross it.
    function projectParticles(dt) {
        const yscale = Math.cos(ptr.inc);
        const inner = R * INNER_U, outer = R * OUTER_U;
        const span = outer - inner;
        const bx = cx + ptr.px, by = cy + ptr.py;
        frontParticles.length = 0;
        backParticles.length = 0;

        for (let i = 0; i < particles.length; i++) {
            let p = particles[i];
            let rr = inner + span * p.ru;
            // Keplerian angular speed (faster inner).
            const omega = 1.9 / Math.pow(rr / R, 1.5) * p.jitter;
            p.a += omega * dt;
            p.ru -= dt * 0.018 * (1.2 - p.ru);              // slow inward spiral
            if (p.ru <= 0) {
                p = spawnParticle(false);
                p.ru = 0.92 + rnd() * 0.08;
                particles[i] = p;
            }
            rr = inner + span * p.ru;

            const sinA = Math.sin(p.a), cosA = Math.cos(p.a);
            const near = sinA >= 0;

            p.x = bx + cosA * rr;
            let y = by + sinA * rr * yscale;
            if (!near) y -= liftAt(rr) * (-sinA);           // lens the back up over the top
            p.y = y;

            // tangential velocity direction (screen space) for the motion-blur streak
            let vx = -sinA, vy = cosA * yscale;
            const vlen = Math.hypot(vx, vy) || 1; vx /= vlen; vy /= vlen;
            p.vx = vx;
            p.vy = vy;

            const u = 1 - p.ru;                              // 1 = hot inner
            const speed = omega * rr;
            p.u = u;
            p.trail = Math.min(R * (perf.mobile ? 0.12 : 0.16), 1.5 + speed * (perf.mobile ? 0.036 : 0.05));

            // proximity to the singularity: 0 at the rim, 1 at the inner edge,
            // ramped non-linearly so the glow surges as material falls inward
            // (mimics the steep rise in temperature/intensity near the hole).
            const prox = u * u * (3 - 2 * u);                // smoothstep(u)
            p.prox = prox;

            if (near) frontParticles.push(p); else backParticles.push(p);
        }
    }

    function drawParticles(list) {
        const flareBoost = 1 + ptr.flare * 1.1;
        const dopBias = ptr.dop;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';

        for (let i = 0; i < list.length; i++) {
            const p = list[i];
            const x = p.x, y = p.y, vx = p.vx, vy = p.vy;
            const u = p.u, prox = p.prox, trail = p.trail;
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
            if (prox > perf.glowMin && (!perf.mobile || prox > 0.47 || (p.id & 1) === 0)) {
                ctx.strokeStyle = 'rgba(' + r8 + ',' + g8 + ',' + b8 + ',' + Math.min(0.4, a * 0.45 * prox).toFixed(3) + ')';
                ctx.lineWidth = ((0.6 + p.thick * 1.3 + u * 1.2) + 2.5 + prox * 5.5) * perf.strokeScale;
                ctx.beginPath();
                ctx.moveTo(x - vx * trail, y - vy * trail);
                ctx.lineTo(x, y);
                ctx.stroke();
            }

            ctx.strokeStyle = 'rgba(' + r8 + ',' + g8 + ',' + b8 + ',' + a.toFixed(3) + ')';
            ctx.lineWidth = (0.6 + p.thick * 1.3 + u * 1.2) * perf.strokeScale;
            ctx.beginPath();
            ctx.moveTo(x - vx * trail, y - vy * trail);
            ctx.lineTo(x, y);
            ctx.stroke();

            // bright white-hot head for the closest, fastest particles
            if (prox > perf.headMin) {
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

    function drawLensingRing(time) {
        const bx = cx + ptr.px, by = cy + ptr.py;
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.8);
        const radius = R * 1.36;
        const segments = perf.mobile ? 3 : 5;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';

        for (let i = 0; i < segments; i++) {
            const start = time * (0.05 + i * 0.006) + i * TAU / segments;
            const len = 0.44 + 0.22 * Math.sin(time * 0.7 + i * 1.9);
            const a = 0.08 + 0.06 * pulse + (i % 2) * 0.035;
            ctx.strokeStyle = 'rgba(255,210,226,' + a.toFixed(3) + ')';
            ctx.lineWidth = (1.0 + i * 0.18) * perf.strokeScale;
            ctx.beginPath();
            ctx.arc(bx, by, radius + i * R * 0.035, start, start + len);
            ctx.stroke();
        }
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
        ctx.fillStyle = vignetteGradient || 'rgba(4,2,7,0.5)';
        ctx.fillRect(0, 0, W, H);
    }

    // ---- main loop ----
    let last = performance.now(), lastPaint = 0, running = true, flareAcc = 0;
    document.addEventListener('visibilitychange', () => {
        running = !document.hidden;
        if (running) {
            last = performance.now();
            lastPaint = 0;
        }
    });

    function ease(cur, tgt, k, dt) { return cur + (tgt - cur) * (1 - Math.exp(-k * dt)); }

    function frame(now) {
        requestAnimationFrame(frame);
        if (running) {
            const frameInterval = 1000 / perf.fps;
            if (now - lastPaint < frameInterval) return;

            const dt = Math.min((now - last) / 1000, 0.06);
            last = now;
            lastPaint = now;
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
            projectParticles(dt);

            // back of disk (behind / lensed over the top)
            drawGasHalf(false, time);
            drawParticles(backParticles);

            // the hole itself — soft, no drawn outline
            drawVoid();
            drawLensingRing(time);

            // front of disk (in front of the hole's lower edge)
            drawGasHalf(true, time);
            drawParticles(frontParticles);

            drawFlares(time, dt);
            vignette();
        } else {
            last = now;
            lastPaint = now;
        }
    }
    requestAnimationFrame(frame);
})();
