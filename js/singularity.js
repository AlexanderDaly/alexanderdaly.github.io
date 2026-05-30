// Interactive gravitationally-lensed black hole.
// Renders a Kerr-style accretion disk with a photon ring, lensed "over-the-top"
// arc (the far side of the disk bent above the shadow), Doppler beaming, and a
// retrocyber perspective grid + starfield. The view is interactive: moving the
// pointer orbits the inclination and shifts the Doppler side; clicking drops an
// infalling flare. Pure 2D canvas — stylized, not a geodesic solver.

(function () {
    'use strict';

    const canvas = document.getElementById('singularity-bg');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const TAU = Math.PI * 2;
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, S = 0;
    let R = 0;                 // event-horizon (shadow) radius, px
    let t0 = performance.now();

    // ---- interaction state (eased toward targets) ----
    const ptr = {
        inc: 1.02, incT: 1.02,        // viewing inclination (rad): small=face-on, ~1.4=edge-on
        px: 0, pxT: 0,                // horizontal parallax offset (px)
        py: 0, pyT: 0,                // vertical parallax offset (px)
        dop: 0, dopT: 0,             // extra Doppler bias from cursor x
        flare: 0                     // click flare envelope (0..1, decays)
    };

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
    }
    resize();
    window.addEventListener('resize', resize);

    // ---- deterministic starfield ----
    let _s = 0x2545F491;
    function rnd() { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 0xFFFFFFFF); }
    const stars = [];
    for (let i = 0; i < 260; i++) stars.push({ fx: rnd(), fy: rnd(), r: rnd() * 1.2 + 0.2, tw: rnd() * TAU, sp: 0.4 + rnd() });

    // ---- accretion-disk temperature ramp (cool outer -> hot inner) ----
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

    // smooth pseudo-noise for turbulence (sum of sines, cheap & seamless in theta)
    function turb(theta, ring, time) {
        return 0.5
            + 0.30 * Math.sin(theta * 3 + ring * 1.7 + time * 0.6)
            + 0.18 * Math.sin(theta * 7 - ring * 0.9 - time * 0.9)
            + 0.12 * Math.sin(theta * 13 + ring * 2.3 + time * 1.4);
    }

    // ---- pointer / interaction ----
    function onMove(clientX, clientY) {
        const mx = clientX / W, my = clientY / H;          // 0..1
        ptr.incT = 0.45 + my * 0.92;                        // top: face-on, bottom: edge-on
        ptr.pxT = (mx - 0.5) * R * 0.9;                     // parallax
        ptr.pyT = (my - 0.5) * R * 0.4;
        ptr.dopT = (mx - 0.5) * 0.6;                        // bias bright side toward cursor
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
        // receding horizontal lines below the horizon
        const drift = (time * 0.06) % 1;
        for (let i = 0; i < 16; i++) {
            const f = (i + drift) / 16;
            const y = horizon + Math.pow(f, 2.2) * (H - horizon) * 1.1;
            if (y > H) continue;
            const a = 0.10 * (1 - f);
            ctx.strokeStyle = 'rgba(255,60,120,' + a.toFixed(3) + ')';
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        // radial verticals converging toward center bottom
        const vp = cx + ptr.px * 0.5;
        for (let i = -10; i <= 10; i++) {
            const x = vp + i * (W / 14);
            const a = 0.07 * (1 - Math.abs(i) / 11);
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

    // ---- the disk ----
    // Draw one half (far=over-the-top, or near=front band) of the lensed disk.
    function drawDiskHalf(near, time) {
        const yscale = Math.cos(ptr.inc);                  // flat-projection squash
        const inner = R * 1.35, outer = R * 7.6;
        const rings = W < 700 ? 26 : 42;
        const segs = W < 700 ? 60 : 96;
        const bx = cx + ptr.px, by = cy + ptr.py;
        const dop = 0.55 + ptr.dop;                        // Doppler strength (approaching side brighter)
        const flareBoost = 1 + ptr.flare * 0.8;
        ctx.globalCompositeOperation = 'lighter';

        for (let ri = 0; ri < rings; ri++) {
            const fr = ri / (rings - 1);
            const r = inner + (outer - inner) * fr * fr;   // pack rings toward the hot inner edge
            const u = 1 - fr;                               // hotter inboard
            const col = temp(u * 0.85 + 0.1);
            // inner rings bulge their FAR edge up over the shadow (lensing)
            const lift = R * 1.25 * Math.exp(-fr * 2.4);
            const baseA = (0.05 + 0.16 * u) * flareBoost;
            const lw = (near ? 2.2 : 1.8) + u * 2.4;

            ctx.lineWidth = lw;
            ctx.beginPath();
            let started = false;
            for (let si = 0; si <= segs; si++) {
                const th = (si / segs) * TAU;
                const sinT = Math.sin(th), cosT = Math.cos(th);
                // near half = front (lower, sinT>0); far half = back (upper, drawn lifted)
                const isNear = sinT >= 0;
                if (isNear !== near) { started = false; continue; }
                const tj = 1 + 0.05 * (turb(th, ri, time) - 0.5) * 2; // radial turbulence
                const rr = r * tj;
                const x = bx + cosT * rr;
                let y = by + sinT * rr * yscale;
                if (!near) y -= lift * (-sinT);            // lift the far arc over the top
                if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
            }
            // Doppler + turbulence brightness, biased to the approaching (left) side
            const tBright = 0.6 + 0.4 * turb(time * 0.7, ri, time);
            const a = baseA * tBright;
            // approaching side ~ left: brighten via a gradient stroke fallback (single alpha here)
            ctx.strokeStyle = 'rgba(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ',' + Math.min(0.9, a).toFixed(3) + ')';
            ctx.stroke();
        }

        // Doppler hotspot: a bright crescent on the approaching limb
        const limbX = bx - Math.cos(ptr.dop) * R * 2.6;
        const limbY = by;
        const g = ctx.createRadialGradient(limbX, limbY, 0, limbX, limbY, R * 3.2);
        g.addColorStop(0, 'rgba(255,240,210,' + (0.10 * dop * flareBoost).toFixed(3) + ')');
        g.addColorStop(0.5, 'rgba(255,140,70,' + (0.06 * dop).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255,60,80,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
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
            const y = by + Math.sin(f.ang) * f.r * yscale - (f.r < R * 2 ? 0 : 0);
            const a = f.life * 0.7;
            const g = ctx.createRadialGradient(x, y, 0, x, y, R * 0.6);
            g.addColorStop(0, 'rgba(255,250,235,' + a.toFixed(3) + ')');
            g.addColorStop(1, 'rgba(255,90,70,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 0.6, 0, TAU); ctx.fill();
        }
    }

    function drawShadowAndRing() {
        const bx = cx + ptr.px, by = cy + ptr.py;
        // shadow
        ctx.globalCompositeOperation = 'source-over';
        const sg = ctx.createRadialGradient(bx, by, R * 0.2, bx, by, R * 1.08);
        sg.addColorStop(0, '#000000');
        sg.addColorStop(0.82, '#000000');
        sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(bx, by, R * 1.12, 0, TAU); ctx.fill();
        // photon ring (bright, slightly Doppler-asymmetric)
        ctx.globalCompositeOperation = 'lighter';
        for (let k = 0; k < 3; k++) {
            const rr = R * (1.02 + k * 0.012);
            ctx.lineWidth = 2.4 - k * 0.6;
            const a = (0.55 - k * 0.14) * (1 + ptr.flare * 0.6);
            ctx.strokeStyle = 'rgba(255,' + (220 - k * 30) + ',' + (190 - k * 50) + ',' + a.toFixed(3) + ')';
            ctx.beginPath(); ctx.arc(bx, by, rr, 0, TAU); ctx.stroke();
        }
        // approaching-limb brightening on the ring
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = 'rgba(255,250,235,' + (0.5 + ptr.dop * 0.2).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(bx, by, R * 1.03, Math.PI * 0.6, Math.PI * 1.4);
        ctx.stroke();
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

            // ease interaction
            ptr.inc = ease(ptr.inc, ptr.incT, 4, dt);
            ptr.px = ease(ptr.px, ptr.pxT, 5, dt);
            ptr.py = ease(ptr.py, ptr.pyT, 5, dt);
            ptr.dop = ease(ptr.dop, ptr.dopT, 4, dt);
            ptr.flare = Math.max(0, ptr.flare - dt * 1.3);

            // occasional ambient flare
            if (!reduceMotion) { flareAcc += dt; if (flareAcc > 3.2) { flareAcc = 0; spawnFlare(); } }

            // base wipe (slight trail for phosphor persistence)
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = 'rgba(6,4,9,1)';
            ctx.fillRect(0, 0, W, H);

            drawGrid(time);
            drawStars(time);
            drawDiskHalf(false, time);   // far side (over the top), behind shadow
            drawShadowAndRing();
            drawDiskHalf(true, time);    // near side (front band), over shadow bottom
            drawFlares(time, dt);
            vignette();
        } else {
            last = now;
        }
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
})();
