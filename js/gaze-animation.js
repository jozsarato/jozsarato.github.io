/*
 * Simulated eye-tracking scanpath drawn behind the site header.
 *
 * - Fixations: log-normal durations (~250 ms median), shown as circles whose
 *   radius grows with fixation duration; gaze drifts slightly during a fixation.
 * - Saccades: amplitudes drawn from a gamma-like distribution with a horizontal
 *   bias; duration follows the main sequence (~21 ms + 2.2 ms/deg) with a
 *   bell-shaped velocity profile.
 * - Raw samples: noisy gaze samples plotted as small dots, like tracker output.
 * - When the mouse is over the header, some saccades land near the cursor.
 */
(function () {
    const header = document.querySelector('.site-header');
    if (!header) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'gaze-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    // inline styles so the layout does not depend on a (possibly cached) stylesheet
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    if (getComputedStyle(header).position === 'static') header.style.position = 'relative';
    header.style.overflow = 'hidden';
    header.prepend(canvas);
    const ctx = canvas.getContext('2d');

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const PX_PER_DEG = 28;          // screen pixels per degree of visual angle
    const SAMPLE_MS = 1000 / 120;   // simulated tracker sampling rate (120 Hz)
    const MAX_FIX = 9;              // fixations kept in the visible trail
    const MAX_SAMPLES = 260;

    const COL_FIX = '120, 180, 255';
    const COL_SAC = '255, 255, 255';
    const COL_RAW = '255, 200, 120';

    let W = 0, H = 0;
    const dpr = window.devicePixelRatio || 1;
    let fixations = [], samples = [], mouse = null;
    let state, visible = true, last = 0, sampleClock = 0;

    function resize() {
        const r = header.getBoundingClientRect();
        W = r.width; H = r.height;
        canvas.width = W * dpr; canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // --- random helpers ---
    function randn() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    function fixationDuration() {           // log-normal, median ~250 ms
        return Math.min(900, Math.max(90, Math.exp(Math.log(250) + 0.4 * randn())));
    }
    function saccadeAmplitudeDeg() {        // gamma(k=2), mean ~5 deg
        return Math.max(0.8, -2.5 * Math.log(Math.random() * Math.random()));
    }

    function nextTarget(x, y) {
        if (mouse && Math.random() < 0.6) {
            return { x: mouse.x + randn() * 14, y: mouse.y + randn() * 14 };
        }
        for (let i = 0; i < 20; i++) {
            const amp = saccadeAmplitudeDeg() * PX_PER_DEG;
            // horizontal saccades are more common than vertical ones
            let ang = Math.random() < 0.7
                ? (Math.random() < 0.5 ? 0 : Math.PI) + randn() * 0.35
                : Math.random() * Math.PI * 2;
            const tx = x + Math.cos(ang) * amp, ty = y + Math.sin(ang) * amp * 0.8;
            if (tx > 10 && tx < W - 10 && ty > 10 && ty < H - 10) return { x: tx, y: ty };
        }
        return { x: W * (0.3 + 0.6 * Math.random()), y: H * (0.2 + 0.6 * Math.random()) };
    }

    function startFixation(x, y) {
        const f = { x, y, dur: fixationDuration(), t: 0, age: 0 };
        fixations.push(f);
        if (fixations.length > MAX_FIX) fixations.shift();
        state = { kind: 'fix', f, gx: x, gy: y, t: 0 };
    }

    function startSaccade(from) {
        const to = nextTarget(from.x, from.y);
        const ampDeg = Math.hypot(to.x - from.x, to.y - from.y) / PX_PER_DEG;
        state = { kind: 'sac', from, to, dur: 21 + 2.2 * ampDeg, t: 0 };
    }

    function gazePosition() {
        if (state.kind === 'fix') return { x: state.gx, y: state.gy };
        // bell-shaped velocity profile -> smooth sigmoidal position
        const p = Math.min(1, state.t / state.dur);
        const s = p - Math.sin(2 * Math.PI * p) / (2 * Math.PI);
        return {
            x: state.from.x + (state.to.x - state.from.x) * s,
            y: state.from.y + (state.to.y - state.from.y) * s,
        };
    }

    function update(dt) {
        state.t += dt;
        if (state.kind === 'fix') {
            state.f.t = state.t;
            // slow ocular drift during the fixation
            state.gx += randn() * 0.12;
            state.gy += randn() * 0.12;
            if (state.t >= state.f.dur) startSaccade({ x: state.gx, y: state.gy });
        } else if (state.t >= state.dur) {
            startFixation(state.to.x, state.to.y);
        }
        fixations.forEach(f => { f.age += dt; });

        sampleClock += dt;
        while (sampleClock >= SAMPLE_MS) {
            sampleClock -= SAMPLE_MS;
            const g = gazePosition();
            samples.push({ x: g.x + randn() * 1.6, y: g.y + randn() * 1.6 });
            if (samples.length > MAX_SAMPLES) samples.shift();
        }
    }

    function draw() {
        ctx.clearRect(0, 0, W, H);
        const n = fixations.length;

        // saccade paths between consecutive fixations
        ctx.lineWidth = 1;
        for (let i = 1; i < n; i++) {
            const a = fixations[i - 1], b = fixations[i];
            ctx.strokeStyle = `rgba(${COL_SAC}, ${0.08 + 0.22 * (i / n)})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        if (state.kind === 'sac' && n) {
            const g = gazePosition(), a = fixations[n - 1];
            ctx.strokeStyle = `rgba(${COL_SAC}, 0.4)`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(g.x, g.y); ctx.stroke();
        }

        // raw gaze samples
        for (let i = 0; i < samples.length; i++) {
            ctx.fillStyle = `rgba(${COL_RAW}, ${0.05 + 0.3 * (i / samples.length)})`;
            ctx.fillRect(samples[i].x - 0.8, samples[i].y - 0.8, 1.6, 1.6);
        }

        // fixations: radius ~ sqrt(duration), older ones fade out
        fixations.forEach((f, i) => {
            const r = 3 + Math.sqrt(Math.min(f.t, f.dur)) * 0.9;
            const alpha = 0.1 + 0.35 * ((i + 1) / n);
            ctx.fillStyle = `rgba(${COL_FIX}, ${alpha * 0.45})`;
            ctx.strokeStyle = `rgba(${COL_FIX}, ${alpha})`;
            ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();
        });

        // current gaze point
        const g = gazePosition();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath(); ctx.arc(g.x, g.y, 2.2, 0, Math.PI * 2); ctx.fill();
    }

    function frame(now) {
        if (visible) {
            const dt = Math.min(50, now - (last || now));
            update(dt);
            draw();
        }
        last = now;
        requestAnimationFrame(frame);
    }

    function init() {
        resize();
        fixations = []; samples = [];
        startFixation(W * 0.6, H * 0.5);
        // pre-run a few seconds so the header starts with a scanpath trail
        for (let i = 0; i < 400; i++) update(10);
        draw();
        // static scanpath for users who prefer reduced motion
        if (reduceMotion) return;
        requestAnimationFrame(frame);
    }

    header.addEventListener('mousemove', e => {
        const r = header.getBoundingClientRect();
        mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    header.addEventListener('mouseleave', () => { mouse = null; });
    window.addEventListener('resize', () => { resize(); if (reduceMotion) draw(); });
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(header);
    }

    init();
})();
