import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const canvas = document.createElement('canvas');
canvas.id = 'singularity-bg';
document.body.prepend(canvas);

const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true,
    antialias: true
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();

// Camera setup
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;
camera.position.y = 1;

// Create the accretion disk (particles)
const particlesGeometry = new THREE.BufferGeometry();
const particlesCount = 5000;

const posArray = new Float32Array(particlesCount * 3);
const colorsArray = new Float32Array(particlesCount * 3);

// Store particle state
const particlesData = [];

const colorInside = new THREE.Color('#ff5500');
const colorOutside = new THREE.Color('#000000');

for (let i = 0; i < particlesCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.5 + Math.random() * 4;
    const speed = 0.02 + Math.random() * 0.05;

    particlesData.push({
        angle: angle,
        radius: radius,
        speed: speed,
        initialRadius: radius,
        yOffset: (Math.random() - 0.5) * 0.2
    });

    // Initial position calculation
    const x = Math.cos(angle) * radius;
    const y = particlesData[i].yOffset;
    const z = Math.sin(angle) * radius;

    posArray[i * 3] = x;
    posArray[i * 3 + 1] = y;
    posArray[i * 3 + 2] = z;

    // Color gradient
    const mixedColor = colorInside.clone();
    mixedColor.lerp(colorOutside, (radius - 1.5) / 4);

    colorsArray[i * 3] = mixedColor.r;
    colorsArray[i * 3 + 1] = mixedColor.g;
    colorsArray[i * 3 + 2] = mixedColor.b;
}

particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colorsArray, 3));

const particlesMaterial = new THREE.PointsMaterial({
    size: 0.02,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending
});

const particlesMesh = new THREE.Points(particlesGeometry, particlesMaterial);
scene.add(particlesMesh);

// Event Horizon (Black Sphere)
const sphereGeometry = new THREE.SphereGeometry(1.2, 32, 32);
const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
scene.add(sphere);

// Glow effect
const glowGeometry = new THREE.SphereGeometry(1.3, 32, 32);
const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffaa00,
    transparent: true,
    opacity: 0.15,
    side: THREE.BackSide
});
const glow = new THREE.Mesh(glowGeometry, glowMaterial);
scene.add(glow);


// Animation
const clock = new THREE.Clock();

function animate() {
    const elapsedTime = clock.getElapsedTime();

    const positions = particlesGeometry.attributes.position.array;
    const colors = particlesGeometry.attributes.color.array;

    for (let i = 0; i < particlesCount; i++) {
        const data = particlesData[i];

        // Update angle and radius
        // Closer particles move faster
        const speedMultiplier = 1 + (5.5 - data.radius) * 0.5;
        data.angle += data.speed * speedMultiplier * 0.01;
        data.radius -= 0.003 * speedMultiplier;

        // Reset if sucked in
        if (data.radius < 1.2) {
            data.radius = 5.5;
            data.angle = Math.random() * Math.PI * 2;
        }

        const x = Math.cos(data.angle) * data.radius;
        const z = Math.sin(data.angle) * data.radius;

        positions[i * 3] = x;
        positions[i * 3 + 2] = z;

        // Update color based on new radius
        const mixedColor = colorInside.clone();
        mixedColor.lerp(colorOutside, (data.radius - 1.5) / 4);

        colors[i * 3] = mixedColor.r;
        colors[i * 3 + 1] = mixedColor.g;
        colors[i * 3 + 2] = mixedColor.b;
    }

    particlesGeometry.attributes.position.needsUpdate = true;
    particlesGeometry.attributes.color.needsUpdate = true;

    // Subtle camera movement
    camera.position.x = Math.sin(elapsedTime * 0.1) * 0.5;
    camera.position.y = 1 + Math.cos(elapsedTime * 0.1) * 0.2;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

animate();

// Resize handler
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
