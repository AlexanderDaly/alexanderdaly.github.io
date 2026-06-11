// Uniform distribution sampler and visualization.
//
// Draws seeded samples from U(0, 1), then renders both a histogram and an
// empirical CDF against their theoretical targets.

(function () {
    'use strict';

    const canvas = document.getElementById('uniform-canvas');
    if (!canvas) return;

    const frame = canvas.parentElement;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    const projectPanel = canvas.closest('[data-project-panel]');
    let projectActive = !projectPanel || !projectPanel.hidden;

    const ui = {
        toggle: document.getElementById('ud-toggle'),
        draw: document.getElementById('ud-draw'),
        reset: document.getElementById('ud-reset'),
        reroll: document.getElementById('ud-reroll'),
        rate: document.getElementById('ud-rate'),
        rateValue: document.getElementById('ud-rate-value'),
        bins: document.getElementById('ud-bins'),
        binsValue: document.getElementById('ud-bins-value'),
        left: document.getElementById('ud-left'),
        leftValue: document.getElementById('ud-left-value'),
        right: document.getElementById('ud-right'),
        rightValue: document.getElementById('ud-right-value'),
        seed: document.getElementById('ud-seed'),
        status: document.getElementById('ud-status'),
        live: document.querySelector('.uniform-live'),
        samples: document.getElementById('ud-samples'),
        mean: document.getElementById('ud-mean'),
        variance: document.getElementById('ud-variance'),
        observed: document.getElementById('ud-observed'),
        expected: document.getElementById('ud-expected'),
        error: document.getElementById('ud-error')
    };

    let W = 0, H = 0, dpr = 1;
    let rng = makeRng('uniform-2026');
    let samples = [];
    let counts = [];
    let total = 0;
    let sum = 0;
    let sumSq = 0;
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

    function hashSeed(text) {
        let h = 2166136261;
        const input = String(text || 'uniform-distribution');
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

    function fmt(value, digits) {
        if (!Number.isFinite(value)) return '0.000';
        return value.toFixed(digits == null ? 3 : digits);
    }

    function currentBins() {
        return clamp(num(ui.bins, 20), 6, 40);
    }

    function interval() {
        let left = clamp(num(ui.left, 25), 0, 95) / 100;
        let right = clamp(num(ui.right, 75), 5, 100) / 100;
        if (right <= left) {
            if (ui.right === document.activeElement) left = Math.max(0, right - 0.01);
            else right = Math.min(1, left + 0.01);
        }
        return { left, right };
    }

    function syncIntervalInputs() {
        const range = interval();
        if (ui.left) ui.left.value = Math.round(range.left * 100);
        if (ui.right) ui.right.value = Math.round(range.right * 100);
        return range;
    }

    function resetCounts() {
        counts = new Array(currentBins()).fill(0);
        for (const value of samples) {
            const bin = Math.min(counts.length - 1, Math.floor(value * counts.length));
            counts[bin]++;
        }
    }

    function reset() {
        rng = makeRng(ui.seed && ui.seed.value);
        samples = [];
        total = 0;
        sum = 0;
        sumSq = 0;
        resetCounts();
        updateReadouts();
        render();
        if (running && visible) startLoop();
    }

    function addSamples(n) {
        const bins = currentBins();
        if (counts.length !== bins) resetCounts();

        for (let i = 0; i < n; i++) {
            const value = rng();
            samples.push(value);
            total++;
            sum += value;
            sumSq += value * value;
            counts[Math.min(bins - 1, Math.floor(value * bins))]++;
        }

    }

    function observedProbability(range) {
        if (!total) return 0;
        let inside = 0;
        for (const value of samples) {
            if (value >= range.left && value <= range.right) inside++;
        }
        return inside / samples.length;
    }

    function maxBinError() {
        if (!total || !counts.length) return 0;
        const expected = 1 / counts.length;
        let max = 0;
        for (const count of counts) max = Math.max(max, Math.abs(count / total - expected));
        return max;
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
        bg.addColorStop(0, '#080912');
        bg.addColorStop(0.54, '#05060a');
        bg.addColorStop(1, '#030407');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        const glow = ctx.createRadialGradient(W * 0.48, H * 0.45, 0, W * 0.48, H * 0.45, Math.max(W, H) * 0.62);
        glow.addColorStop(0, 'rgba(255,191,105,0.075)');
        glow.addColorStop(0.48, 'rgba(120,240,255,0.035)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
    }

    function drawPanelBox(x, y, width, height, label) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(255,138,43,0.23)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
        ctx.fillStyle = 'rgba(255,191,105,0.72)';
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(label, x + 10, y + 17);
    }

    function drawHistogram(plot, range) {
        const { x, y, width, height } = plot;
        const bins = counts.length || currentBins();
        const expectedCount = total / bins;
        const maxCount = Math.max(1, expectedCount * 1.6, ...counts);
        const intervalX = x + range.left * width;
        const intervalW = Math.max(1, (range.right - range.left) * width);

        ctx.fillStyle = 'rgba(255,138,43,0.08)';
        ctx.fillRect(intervalX, y, intervalW, height);

        ctx.strokeStyle = 'rgba(247,238,240,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 4; i++) {
            const py = y + height * i / 4;
            ctx.moveTo(x, py + 0.5);
            ctx.lineTo(x + width, py + 0.5);
        }
        ctx.stroke();

        const barW = width / bins;
        for (let i = 0; i < bins; i++) {
            const h = counts[i] / maxCount * height;
            const bx = x + i * barW + 1;
            const by = y + height - h;
            const inBand = (i + 0.5) / bins >= range.left && (i + 0.5) / bins <= range.right;
            const grad = ctx.createLinearGradient(0, by, 0, y + height);
            if (inBand) {
                grad.addColorStop(0, 'rgba(255,191,105,0.92)');
                grad.addColorStop(1, 'rgba(255,138,43,0.25)');
            } else {
                grad.addColorStop(0, 'rgba(120,240,255,0.78)');
                grad.addColorStop(1, 'rgba(120,240,255,0.16)');
            }
            ctx.fillStyle = grad;
            ctx.fillRect(bx, by, Math.max(1, barW - 2), h);
        }

        if (total) {
            const expectedY = y + height - (expectedCount / maxCount) * height;
            ctx.strokeStyle = 'rgba(255,46,68,0.72)';
            ctx.setLineDash([7, 7]);
            ctx.beginPath();
            ctx.moveTo(x, expectedY);
            ctx.lineTo(x + width, expectedY);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    function drawCdf(plot, range) {
        const { x, y, width, height } = plot;
        const intervalX = x + range.left * width;
        const intervalW = Math.max(1, (range.right - range.left) * width);
        ctx.fillStyle = 'rgba(255,138,43,0.08)';
        ctx.fillRect(intervalX, y, intervalW, height);

        ctx.strokeStyle = 'rgba(247,238,240,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 4; i++) {
            const py = y + height * i / 4;
            const px = x + width * i / 4;
            ctx.moveTo(x, py + 0.5);
            ctx.lineTo(x + width, py + 0.5);
            ctx.moveTo(px + 0.5, y);
            ctx.lineTo(px + 0.5, y + height);
        }
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255,46,68,0.72)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(x, y + height);
        ctx.lineTo(x + width, y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (!samples.length) return;
        const stride = Math.max(1, Math.floor(samples.length / 2400));
        const subset = [];
        for (let i = 0; i < samples.length; i += stride) subset.push(samples[i]);
        subset.sort((a, b) => a - b);

        ctx.strokeStyle = 'rgba(120,240,255,0.88)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y + height);
        for (let i = 0; i < subset.length; i++) {
            const px = x + subset[i] * width;
            const py = y + height - (i + 1) / subset.length * height;
            ctx.lineTo(px, py);
        }
        ctx.lineTo(x + width, y);
        ctx.stroke();
    }

    function drawLabels(hist, cdf) {
        ctx.fillStyle = 'rgba(247,238,240,0.48)';
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText('0', hist.x, hist.y + hist.height + 15);
        ctx.fillText('1', hist.x + hist.width - 6, hist.y + hist.height + 15);
        ctx.fillText('0', cdf.x, cdf.y + cdf.height + 15);
        ctx.fillText('1', cdf.x + cdf.width - 6, cdf.y + cdf.height + 15);
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
        const gap = W < 620 ? 32 : 38;
        const histH = Math.max(150, Math.round((H - pad * 2 - gap) * 0.58));
        const cdfH = Math.max(110, H - pad * 2 - gap - histH);
        const hist = { x: pad, y: pad + 12, width: W - pad * 2, height: histH };
        const cdf = { x: pad, y: hist.y + hist.height + gap, width: W - pad * 2, height: cdfH };
        const range = syncIntervalInputs();

        drawBackground();
        drawPanelBox(hist.x, hist.y, hist.width, hist.height, 'Histogram: empirical density');
        drawHistogram(hist, range);
        drawPanelBox(cdf.x, cdf.y, cdf.width, cdf.height, 'CDF: empirical vs theoretical');
        drawCdf(cdf, range);
        drawLabels(hist, cdf);
        drawVignette();
    }

    function updateReadouts() {
        const bins = currentBins();
        const rate = clamp(num(ui.rate, 80), 5, 240);
        const range = syncIntervalInputs();
        const observed = observedProbability(range);
        const mean = total ? sum / total : 0;
        const variance = total ? (sumSq / total) - mean * mean : 0;

        if (ui.rateValue) ui.rateValue.textContent = String(rate);
        if (ui.binsValue) ui.binsValue.textContent = String(bins);
        if (ui.leftValue) ui.leftValue.textContent = fmt(range.left, 2);
        if (ui.rightValue) ui.rightValue.textContent = fmt(range.right, 2);
        if (ui.samples) ui.samples.textContent = String(total);
        if (ui.mean) ui.mean.textContent = fmt(mean, 3);
        if (ui.variance) ui.variance.textContent = fmt(variance, 3);
        if (ui.observed) ui.observed.textContent = fmt(observed, 3);
        if (ui.expected) ui.expected.textContent = fmt(range.right - range.left, 3);
        if (ui.error) ui.error.textContent = fmt(maxBinError(), 3);
        if (ui.status) ui.status.textContent = running ? 'Sampling' : 'Idle';
        if (ui.toggle) ui.toggle.textContent = running ? 'Pause' : 'Start';
        if (ui.live) ui.live.classList.toggle('is-running', running && visible);
    }

    function tick() {
        if (!(running && visible)) {
            rafId = 0;
            updateReadouts();
            return;
        }
        addSamples(clamp(num(ui.rate, 80), 5, 240));
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

    if (ui.draw) {
        ui.draw.addEventListener('click', () => {
            addSamples(100);
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

    if (ui.rate) ui.rate.addEventListener('input', updateReadouts);
    if (ui.bins) {
        ui.bins.addEventListener('input', () => {
            resetCounts();
            render();
            updateReadouts();
        });
    }

    for (const control of [ui.left, ui.right]) {
        if (!control) continue;
        control.addEventListener('input', () => {
            syncIntervalInputs();
            render();
            updateReadouts();
        });
    }

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

    resetCounts();
    resize();
    updateReadouts();
    if (running && visible) startLoop();
})();
