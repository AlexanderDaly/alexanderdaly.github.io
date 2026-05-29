import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

/*
 * Schwarzschild black-hole accretion disk.
 * Physics modelled:
 *   - Keplerian orbital velocity        omega = sqrt(GM / r^3)
 *   - Shakura-Sunyaev temperature        T ~ r^(-3/4)  -> blackbody colour
 *   - Relativistic Doppler beaming       brightness ~ delta^3, with blueshift
 *   - Gravitational redshift             dimming ~ sqrt(1 - Rs/r) near horizon
 *   - Inner truncation at the ISCO (3 Rs); plunging particles re-seed outward
 * Rendering:
 *   - Soft additive sprites for the disk + a lensed starfield
 *   - A full-screen post pass bends light around the shadow (Einstein ring),
 *     then applies ACES tone mapping, a soft bloom and a vignette.
 *   - If the post pipeline fails to initialise, it falls back to direct render.
 */

const canvas = document.createElement('canvas');
canvas.id = 'singularity-bg';
document.body.prepend(canvas);

let renderer;
try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
    // No WebGL — leave the background black and bail quietly.
    canvas.remove();
    throw e;
}

const PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(PIXEL_RATIO);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);

// ----- Black-hole scale (simulation units, Rs = 1) -------------------------
const Rs = 1.0;            // Schwarzschild (horizon) radius
const ISCO = 3.0 * Rs;     // innermost stable circular orbit
const SHADOW = 2.6 * Rs;   // apparent shadow radius (photon capture)
const DISK_INNER = ISCO;
const DISK_OUTER = 9.0 * Rs;
const GM = 1.0;            // gravitational parameter
const C = 2.0;            // speed of light in sim units (keeps beta < 1)

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);

// Low inclination above the disk plane — gives the classic elliptical sweep.
const camRadius = 17.0;
const camHeight = 3.4;
camera.position.set(0, camHeight, camRadius);
camera.lookAt(0, 0, 0);

// ----- Blackbody-ish colour ramp (hot -> cool) -----------------------------
const tempStops = [
    { t: 0.00, c: new THREE.Color(0xbcd8ff) }, // hottest inner edge: blue-white
    { t: 0.20, c: new THREE.Color(0xffffff) },
    { t: 0.45, c: new THREE.Color(0xffe2a8) },
    { t: 0.70, c: new THREE.Color(0xff9a3c) },
    { t: 1.00, c: new THREE.Color(0x6e1500) }  // cool outer edge: deep red
];
const _col = new THREE.Color();
function colourFromTemp(x) {
    x = Math.min(1, Math.max(0, x));
    for (let i = 0; i < tempStops.length - 1; i++) {
        const a = tempStops[i], b = tempStops[i + 1];
        if (x <= b.t) {
            const f = (x - a.t) / (b.t - a.t);
            return _col.copy(a.c).lerp(b.c, f);
        }
    }
    return _col.copy(tempStops[tempStops.length - 1].c);
}

// ----- Accretion disk particles --------------------------------------------
const DISK_COUNT = 9000;
const diskGeo = new THREE.BufferGeometry();
const diskPos = new Float32Array(DISK_COUNT * 3);
const diskColor = new Float32Array(DISK_COUNT * 3);
const diskSize = new Float32Array(DISK_COUNT);
const disk = [];

function seedParticle(i, freshOuter) {
    const r = freshOuter
        ? DISK_OUTER - Math.random() * 1.5
        : DISK_INNER + Math.pow(Math.random(), 0.6) * (DISK_OUTER - DISK_INNER);
    const angle = Math.random() * Math.PI * 2;
    // Thin disk: scale height grows gently with radius, plus turbulence seed.
    const h = 0.04 * r;
    disk[i] = {
        r, angle,
        y: (Math.random() - 0.5) * h,
        turb: Math.random() * Math.PI * 2,
        flick: 0.6 + Math.random() * 0.4
    };
    diskSize[i] = 12.0 + Math.random() * 18.0;
}
for (let i = 0; i < DISK_COUNT; i++) seedParticle(i, false);

diskGeo.setAttribute('position', new THREE.BufferAttribute(diskPos, 3));
diskGeo.setAttribute('color', new THREE.BufferAttribute(diskColor, 3));
diskGeo.setAttribute('aSize', new THREE.BufferAttribute(diskSize, 1));

const diskMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: window.innerHeight * PIXEL_RATIO * 0.5 } },
    vertexShader: `
        attribute float aSize;
        varying vec3 vColor;
        uniform float uScale;
        void main() {
            vColor = color;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * (uScale / max(-mv.z, 0.001)) * 0.06;
            gl_Position = projectionMatrix * mv;
        }`,
    fragmentShader: `
        varying vec3 vColor;
        void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            a *= a;                       // tighter, glowier core
            gl_FragColor = vec4(vColor * a, a);
        }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    vertexColors: true
});
const diskPoints = new THREE.Points(diskGeo, diskMat);
scene.add(diskPoints);

// ----- Event-horizon shadow (opaque, occludes disk behind it) --------------
const shadow = new THREE.Mesh(
    new THREE.SphereGeometry(SHADOW, 48, 48),
    new THREE.MeshBasicMaterial({ color: 0x000000 })
);
scene.add(shadow);

// Thin warm halo just outside the shadow.
const halo = new THREE.Mesh(
    new THREE.SphereGeometry(SHADOW * 1.06, 48, 48),
    new THREE.MeshBasicMaterial({ color: 0xffb24d, transparent: true, opacity: 0.12, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })
);
scene.add(halo);

// ----- Lensed starfield ----------------------------------------------------
const STAR_COUNT = 1800;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(STAR_COUNT * 3);
const starColor = new Float32Array(STAR_COUNT * 3);
const starSize = new Float32Array(STAR_COUNT);
for (let i = 0; i < STAR_COUNT; i++) {
    const u = Math.random(), v = Math.random();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const R = 120 + Math.random() * 60;
    starPos[i * 3] = R * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = R * Math.cos(phi);
    starPos[i * 3 + 2] = R * Math.sin(phi) * Math.sin(theta);
    const warm = Math.random();
    const c = new THREE.Color().setHSL(0.55 + warm * 0.12, 0.4, 0.7 + Math.random() * 0.3);
    starColor[i * 3] = c.r; starColor[i * 3 + 1] = c.g; starColor[i * 3 + 2] = c.b;
    starSize[i] = 4 + Math.random() * 10;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
starGeo.setAttribute('color', new THREE.BufferAttribute(starColor, 3));
starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));
const starMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: window.innerHeight * PIXEL_RATIO * 0.5 }, uTime: { value: 0 } },
    vertexShader: `
        attribute float aSize;
        varying vec3 vColor;
        varying float vTw;
        uniform float uScale; uniform float uTime;
        void main() {
            vColor = color;
            vTw = 0.7 + 0.3 * sin(uTime * 2.0 + position.x * 0.3 + position.y * 0.7);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * (uScale / max(-mv.z, 0.001)) * 0.02;
            gl_Position = projectionMatrix * mv;
        }`,
    fragmentShader: `
        varying vec3 vColor; varying float vTw;
        void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            gl_FragColor = vec4(vColor * a * vTw, a);
        }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: true
});
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

// ----- Post pipeline: gravitational lensing + tone map + bloom + vignette --
let composer = null;
try {
    const makeTarget = () => new THREE.WebGLRenderTarget(
        Math.floor(window.innerWidth * PIXEL_RATIO),
        Math.floor(window.innerHeight * PIXEL_RATIO),
        { type: THREE.HalfFloatType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter }
    );
    const sceneTarget = makeTarget();

    const postScene = new THREE.Scene();
    const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const postMat = new THREE.ShaderMaterial({
        uniforms: {
            tScene: { value: sceneTarget.texture },
            uAspect: { value: window.innerWidth / window.innerHeight },
            uCenter: { value: new THREE.Vector2(0.5, 0.5) },
            uShadow: { value: 0.06 },   // shadow radius in screen units (set per frame)
            uLens: { value: 0.010 },    // deflection strength (set per frame)
            uTexel: { value: new THREE.Vector2(1 / (window.innerWidth * PIXEL_RATIO), 1 / (window.innerHeight * PIXEL_RATIO)) }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: `
            precision highp float;
            varying vec2 vUv;
            uniform sampler2D tScene;
            uniform float uAspect, uShadow, uLens;
            uniform vec2 uCenter, uTexel;

            vec3 aces(vec3 x){
                const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
                return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
            }

            void main() {
                // Aspect-corrected polar coords around the black hole.
                vec2 p = (vUv - uCenter) * vec2(uAspect, 1.0);
                float r = length(p);
                vec2 dir = r > 1e-5 ? p / r : vec2(0.0);

                // Schwarzschild-style deflection: pull the apparent ray inward.
                float bend = uLens / max(r, uShadow * 0.5);
                float nr = r - bend;

                vec3 col;
                if (nr <= uShadow) {
                    col = vec3(0.0);                       // inside the shadow
                } else {
                    vec2 np = uCenter + (dir * nr) / vec2(uAspect, 1.0);
                    col = texture2D(tScene, np).rgb;

                    // Cheap bloom: sample a small ring of bright neighbours.
                    vec3 bloom = vec3(0.0);
                    for (int k = 0; k < 8; k++) {
                        float ang = float(k) * 0.7853981634;
                        vec2 off = vec2(cos(ang), sin(ang)) * uTexel * 3.0;
                        vec3 s = texture2D(tScene, np + off).rgb;
                        bloom += max(s - 0.6, 0.0);
                    }
                    col += bloom * 0.18;
                }

                // Einstein ring: brighten light grazing the photon sphere.
                float ring = smoothstep(uShadow * 1.18, uShadow, nr) *
                             smoothstep(uShadow * 0.92, uShadow, nr);
                col += vec3(1.0, 0.72, 0.4) * ring * 0.6;

                // Tone map + vignette.
                col = aces(col * 1.15);
                float vig = smoothstep(1.15, 0.35, length(vUv - 0.5));
                col *= mix(0.55, 1.0, vig);

                gl_FragColor = vec4(col, 1.0);
            }`
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
    postScene.add(quad);

    composer = { sceneTarget, postScene, postCam, postMat, makeTarget };
} catch (e) {
    composer = null; // fall back to direct rendering
}

// ----- Pointer parallax ----------------------------------------------------
const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
window.addEventListener('pointermove', (ev) => {
    pointer.tx = (ev.clientX / window.innerWidth - 0.5);
    pointer.ty = (ev.clientY / window.innerHeight - 0.5);
}, { passive: true });

// ----- Simulation step -----------------------------------------------------
const SPEED = 0.45;          // global time scale
const DRIFT = 0.020;         // inward accretion rate
const _v = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _proj = new THREE.Vector3();
const clock = new THREE.Clock();

function step(dt, t) {
    const positions = diskGeo.attributes.position.array;
    const colors = diskGeo.attributes.color.array;

    for (let i = 0; i < DISK_COUNT; i++) {
        const d = disk[i];
        const omega = Math.sqrt(GM / (d.r * d.r * d.r)); // Keplerian angular speed
        d.angle += omega * SPEED * dt;
        d.r -= DRIFT * omega * SPEED * dt * d.r;          // slow inspiral

        if (d.r <= DISK_INNER) { seedParticle(i, true); continue; }

        const cosA = Math.cos(d.angle), sinA = Math.sin(d.angle);
        // Animated vertical turbulence keeps the disk alive.
        const yWobble = d.y + Math.sin(t * 1.3 + d.turb) * 0.03 * d.r;
        const x = cosA * d.r, z = sinA * d.r;
        positions[i * 3] = x;
        positions[i * 3 + 1] = yWobble;
        positions[i * 3 + 2] = z;

        // --- Relativistic Doppler beaming ---
        const v = Math.sqrt(GM / d.r);          // orbital speed
        const beta = Math.min(v / C, 0.85);
        const gamma = 1 / Math.sqrt(1 - beta * beta);
        // Tangential velocity unit vector in the disk plane.
        _v.set(-sinA, 0, cosA);
        _toCam.set(camera.position.x - x, camera.position.y - yWobble, camera.position.z - z).normalize();
        const cosTheta = _v.dot(_toCam);
        const delta = 1 / (gamma * (1 - beta * cosTheta)); // Doppler factor
        const beam = Math.min(Math.pow(delta, 3), 6.0);

        // --- Temperature -> colour (Shakura-Sunyaev, T ~ r^-3/4) ---
        const tNorm = Math.pow((d.r - DISK_INNER) / (DISK_OUTER - DISK_INNER), 0.55);
        const col = colourFromTemp(tNorm);
        // Gravitational redshift dims the deepest material.
        const grav = Math.sqrt(Math.max(1 - Rs / d.r, 0.02));
        // Blueshift tint when material races toward us.
        const blue = Math.min(Math.max((delta - 1) * 0.6, 0), 0.5);

        const bright = beam * grav * d.flick;
        colors[i * 3] = Math.min(col.r * bright * (1 - blue * 0.4), 8.0);
        colors[i * 3 + 1] = Math.min(col.g * bright * (1 - blue * 0.1), 8.0);
        colors[i * 3 + 2] = Math.min((col.b + blue) * bright, 8.0);
    }
    diskGeo.attributes.position.needsUpdate = true;
    diskGeo.attributes.color.needsUpdate = true;
}

// ----- Render loop ---------------------------------------------------------
let running = true;
document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) { clock.getDelta(); animate(); }
});

function animate() {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    step(dt, t);
    starMat.uniforms.uTime.value = t;

    // Slow camera orbit + gentle pointer parallax.
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;
    const orbit = t * 0.05;
    camera.position.x = Math.sin(orbit) * camRadius + pointer.x * 2.0;
    camera.position.z = Math.cos(orbit) * camRadius;
    camera.position.y = camHeight + pointer.y * 1.2 + Math.sin(t * 0.13) * 0.4;
    camera.lookAt(0, 0, 0);

    if (composer) {
        // Project the black-hole centre to screen space for the lens.
        _proj.set(0, 0, 0).project(camera);
        composer.postMat.uniforms.uCenter.value.set(_proj.x * 0.5 + 0.5, _proj.y * 0.5 + 0.5);
        // Shadow apparent size: project a point at the shadow edge.
        _proj.set(SHADOW, 0, 0).project(camera);
        const edgeX = _proj.x * 0.5 + 0.5;
        const screenShadow = Math.abs(edgeX - composer.postMat.uniforms.uCenter.value.x) * composer.postMat.uniforms.uAspect.value;
        composer.postMat.uniforms.uShadow.value = Math.max(screenShadow, 0.02);
        composer.postMat.uniforms.uLens.value = screenShadow * 0.5; // deflection scales with shadow

        renderer.setRenderTarget(composer.sceneTarget);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        renderer.render(composer.postScene, composer.postCam);
    } else {
        renderer.render(scene, camera);
    }

    requestAnimationFrame(animate);
}
animate();

// ----- Resize --------------------------------------------------------------
window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    diskMat.uniforms.uScale.value = h * PIXEL_RATIO * 0.5;
    starMat.uniforms.uScale.value = h * PIXEL_RATIO * 0.5;
    if (composer) {
        composer.sceneTarget.setSize(Math.floor(w * PIXEL_RATIO), Math.floor(h * PIXEL_RATIO));
        composer.postMat.uniforms.tScene.value = composer.sceneTarget.texture;
        composer.postMat.uniforms.uAspect.value = w / h;
        composer.postMat.uniforms.uTexel.value.set(1 / (w * PIXEL_RATIO), 1 / (h * PIXEL_RATIO));
    }
});
